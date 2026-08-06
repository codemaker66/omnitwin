import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseFoundryCliArgs,
  resolvePreparedHdPythonExecutable,
  runFoundryCli,
  type FoundryCliSignalSource,
} from "../cli.js";
import type { LocalFoundryAppHandle } from "../local-app.js";

const CAPTURED_QUALITY_TRUSTED_CONTEXT = {
  repoRoot: resolve("captured-quality-fixtures", "repo"),
  qualityRoot: resolve("captured-quality-fixtures", "quality"),
  mobileRoot: resolve("captured-quality-fixtures", "mobile"),
  outputRoot: resolve("captured-quality-fixtures", "output"),
};

const FIXED_WORKSPACE = resolve("fixtures", "saved-intake-workspace");
const FIXED_WORKSPACE_SOURCE = resolve(
  "fixtures",
  "saved-intake-workspace",
  "payload",
  "capture-drop",
);

const CAPTURED_QUALITY_FLAGS = [
  ["--captured-quality-repo-root", CAPTURED_QUALITY_TRUSTED_CONTEXT.repoRoot],
  ["--captured-quality-quality-root", CAPTURED_QUALITY_TRUSTED_CONTEXT.qualityRoot],
  ["--captured-quality-mobile-root", CAPTURED_QUALITY_TRUSTED_CONTEXT.mobileRoot],
  ["--captured-quality-output-root", CAPTURED_QUALITY_TRUSTED_CONTEXT.outputRoot],
] as const;

function localAppArgsWithCapturedQuality(
  flags: readonly (readonly [string, string])[] = CAPTURED_QUALITY_FLAGS,
): string[] {
  return [
    "local-app",
    "--source",
    "capture-drop",
    ...flags.flatMap(([flag, value]) => [flag, value]),
  ];
}

function fakeApp(): LocalFoundryAppHandle {
  return {
    host: "127.0.0.1",
    port: 43_127,
    origin: "http://127.0.0.1:43127",
    url: `http://127.0.0.1:43127/?token=${"a".repeat(43)}`,
    sourceLabel: "capture-drop",
    closed: Promise.resolve({ reason: "programmatic" }),
    stop: () => Promise.resolve(),
    getPhase: () => "stopped",
  };
}

function fakeNativeIntakeApp(): {
  readonly url: string;
  readonly closed: Promise<{ readonly reason: string }>;
  readonly stop: () => Promise<void>;
} {
  return {
    url: `http://127.0.0.1:43128/?token=${"b".repeat(43)}`,
    closed: Promise.resolve({ reason: "programmatic" }),
    stop: () => Promise.resolve(),
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

class RecordingSignalSource implements FoundryCliSignalSource {
  readonly #listeners = new Map<"SIGINT" | "SIGTERM", Set<() => void>>([
    ["SIGINT", new Set()],
    ["SIGTERM", new Set()],
  ]);

  on(signal: "SIGINT" | "SIGTERM", listener: () => void): void {
    this.#listeners.get(signal)?.add(listener);
  }

  off(signal: "SIGINT" | "SIGTERM", listener: () => void): void {
    this.#listeners.get(signal)?.delete(listener);
  }

  emit(signal: "SIGINT" | "SIGTERM"): void {
    for (const listener of [...(this.#listeners.get(signal) ?? [])]) listener();
  }

  listenerCount(signal: "SIGINT" | "SIGTERM"): number {
    return this.#listeners.get(signal)?.size ?? 0;
  }
}

describe("Foundry local app CLI", () => {
  it("parses no source as native intake mode and rejects unknown launcher flags", () => {
    expect(parseFoundryCliArgs(["local-app"])).toEqual({
      kind: "local-app",
      port: 0,
      open: false,
    });
    expect(parseFoundryCliArgs(["local-app", "--open", "--port", "43128"])).toEqual({
      kind: "local-app",
      port: 43_128,
      open: true,
    });
    expect(() => parseFoundryCliArgs(["local-app", "--drop"])).toThrow(
      "Unknown CLI option: --drop.",
    );
  });

  it("parses one fixed source, an optional loopback port, and an explicit open flag", () => {
    expect(parseFoundryCliArgs([
      "local-app",
      "--source", "C:\\capture drop",
    ])).toEqual({
      kind: "local-app",
      source: "C:\\capture drop",
      port: 0,
      open: false,
    });
    expect(parseFoundryCliArgs([
      "local-app",
      "--open",
      "--port", "43127",
      "--source", "capture",
    ])).toEqual({
      kind: "local-app",
      source: "capture",
      port: 43_127,
      open: true,
    });
    expect(() => parseFoundryCliArgs(["local-app", "--source", "capture", "--port", "80"]))
      .toThrow("between 1024 and 65535");
    expect(() => parseFoundryCliArgs(["local-app", "--source", "capture", "--path", "secret"]))
      .toThrow("Unknown CLI option");
    expect(() => parseFoundryCliArgs(["local-app", "--source", "capture", "--open", "true"]))
      .toThrow("Unknown CLI option");
  });

  it("accepts one absolute workspace for a new saved copy or source-free reopen", () => {
    expect(parseFoundryCliArgs([
      "local-app",
      "--source",
      "capture-drop",
      "--workspace",
      FIXED_WORKSPACE,
    ])).toEqual({
      kind: "local-app",
      source: "capture-drop",
      workspace: FIXED_WORKSPACE,
      port: 0,
      open: false,
    });
    expect(parseFoundryCliArgs([
      "local-app",
      "--workspace",
      FIXED_WORKSPACE,
    ])).toEqual({
      kind: "local-app",
      workspace: FIXED_WORKSPACE,
      port: 0,
      open: false,
    });
    expect(() => parseFoundryCliArgs(["local-app", "--workspace", "relative-workspace"]))
      .toThrow("--workspace must be an absolute path");
  });

  it("dispatches no-argument local-app to native intake without resolving Python", async () => {
    const startNativeIntakeApp = vi.fn(() => Promise.resolve(fakeNativeIntakeApp()));
    const startLocalApp = vi.fn(() => Promise.resolve(fakeApp()));
    const resolvePython = vi.fn(() => Promise.reject(new Error("must not resolve Python")));
    const openLocalApp = vi.fn();
    const write = vi.fn<(text: string) => void>();

    await runFoundryCli(["local-app"], {
      env: {},
      write,
      startNativeIntakeApp,
      startLocalApp,
      openLocalApp,
      resolvePreparedHdPythonExecutable: resolvePython,
    });

    expect(startNativeIntakeApp).toHaveBeenCalledOnce();
    expect(startNativeIntakeApp).toHaveBeenCalledWith({ port: 0 });
    expect(startLocalApp).not.toHaveBeenCalled();
    expect(resolvePython).not.toHaveBeenCalled();
    expect(openLocalApp).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Windows picker or native drop panel"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Explorer drop target"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("enhancement, training"));
  });

  it("opens native intake for source-free local-app --open without resolving Python", async () => {
    const app = fakeNativeIntakeApp();
    const startNativeIntakeApp = vi.fn(() => Promise.resolve(app));
    const openLocalApp = vi.fn();
    const resolvePython = vi.fn(() => Promise.reject(new Error("must not resolve Python")));

    await runFoundryCli(["local-app", "--open"], {
      env: {},
      write: vi.fn(),
      startNativeIntakeApp,
      openLocalApp,
      resolvePreparedHdPythonExecutable: resolvePython,
    });

    expect(startNativeIntakeApp).toHaveBeenCalledWith({ port: 0 });
    expect(openLocalApp).toHaveBeenCalledOnce();
    expect(openLocalApp).toHaveBeenCalledWith(app.url);
    expect(resolvePython).not.toHaveBeenCalled();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "stops native intake on %s and waits for confirmed app closure",
    async (signal) => {
      const closed = deferred<{ readonly reason: string }>();
      const stopFinished = deferred<undefined>();
      const stop = vi.fn(() => stopFinished.promise);
      const app = { ...fakeNativeIntakeApp(), closed: closed.promise, stop };
      const signalSource = new RecordingSignalSource();
      const run = runFoundryCli(["local-app"], {
        env: {},
        write: vi.fn(),
        startNativeIntakeApp: () => Promise.resolve(app),
        signalSource,
      });

      await vi.waitFor(() => {
        expect(signalSource.listenerCount(signal)).toBe(1);
      });
      signalSource.emit(signal);
      await vi.waitFor(() => {
        expect(stop).toHaveBeenCalledOnce();
      });
      expect(await Promise.race([
        run.then(() => true),
        new Promise<boolean>((resolveValue) => setTimeout(() => {
          resolveValue(false);
        }, 20)),
      ])).toBe(false);

      closed.resolve({ reason: "programmatic" });
      expect(await Promise.race([
        run.then(() => true),
        new Promise<boolean>((resolveValue) => setTimeout(() => {
          resolveValue(false);
        }, 20)),
      ])).toBe(false);
      stopFinished.resolve(undefined);
      await run;
      expect(signalSource.listenerCount("SIGINT")).toBe(0);
      expect(signalSource.listenerCount("SIGTERM")).toBe(0);
    },
  );

  it("keeps signal handling active and permits a retry after unconfirmed shutdown", async () => {
    const closed = deferred<{ readonly reason: string }>();
    let stopAttempts = 0;
    const stop = vi.fn(() => {
      stopAttempts += 1;
      if (stopAttempts === 1) return Promise.reject(new Error("fixture helper still live"));
      closed.resolve({ reason: "programmatic" });
      return Promise.resolve();
    });
    const app = { ...fakeNativeIntakeApp(), closed: closed.promise, stop };
    const signalSource = new RecordingSignalSource();
    const write = vi.fn<(text: string) => void>();
    const run = runFoundryCli(["local-app"], {
      env: {},
      write,
      startNativeIntakeApp: () => Promise.resolve(app),
      signalSource,
    });

    await vi.waitFor(() => {
      expect(signalSource.listenerCount("SIGINT")).toBe(1);
    });
    signalSource.emit("SIGINT");
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledWith(expect.stringContaining("shutdown was not confirmed"));
    });
    signalSource.emit("SIGTERM");
    await run;

    expect(stop).toHaveBeenCalledTimes(2);
    expect(signalSource.listenerCount("SIGINT")).toBe(0);
    expect(signalSource.listenerCount("SIGTERM")).toBe(0);
  });

  it("does not miss a shutdown signal received while native intake is still starting", async () => {
    const started = deferred<ReturnType<typeof fakeNativeIntakeApp>>();
    const closed = deferred<{ readonly reason: string }>();
    const stop = vi.fn(() => Promise.resolve());
    const signalSource = new RecordingSignalSource();
    const run = runFoundryCli(["local-app"], {
      env: {},
      write: vi.fn(),
      startNativeIntakeApp: () => started.promise,
      signalSource,
    });

    await vi.waitFor(() => {
      expect(signalSource.listenerCount("SIGINT")).toBe(1);
    });
    signalSource.emit("SIGINT");
    expect(stop).not.toHaveBeenCalled();
    started.resolve({ ...fakeNativeIntakeApp(), closed: closed.promise, stop });
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledOnce();
    });

    closed.resolve({ reason: "programmatic" });
    await run;
    expect(signalSource.listenerCount("SIGINT")).toBe(0);
    expect(signalSource.listenerCount("SIGTERM")).toBe(0);
  });

  it("applies the same confirmed signal shutdown to the legacy fixed-source app", async () => {
    const closed = deferred<{ readonly reason: "programmatic" }>();
    const stop = vi.fn(() => Promise.resolve());
    const app: LocalFoundryAppHandle = { ...fakeApp(), closed: closed.promise, stop };
    const signalSource = new RecordingSignalSource();
    const run = runFoundryCli(["local-app", "--source", "capture-drop"], {
      env: {},
      write: vi.fn(),
      startLocalApp: () => Promise.resolve(app),
      signalSource,
    });

    await vi.waitFor(() => {
      expect(signalSource.listenerCount("SIGTERM")).toBe(1);
    });
    signalSource.emit("SIGTERM");
    await vi.waitFor(() => {
      expect(stop).toHaveBeenCalledOnce();
    });
    closed.resolve({ reason: "programmatic" });
    await run;

    expect(signalSource.listenerCount("SIGINT")).toBe(0);
    expect(signalSource.listenerCount("SIGTERM")).toBe(0);
  });

  it("maps all four absolute captured-quality paths as one trusted option", () => {
    expect(parseFoundryCliArgs(localAppArgsWithCapturedQuality())).toEqual({
      kind: "local-app",
      source: "capture-drop",
      port: 0,
      open: false,
      capturedQualityComparison: CAPTURED_QUALITY_TRUSTED_CONTEXT,
    });
  });

  it("rejects every three-of-four captured-quality path combination and a lone path", () => {
    for (const omittedFlag of CAPTURED_QUALITY_FLAGS) {
      expect(() => parseFoundryCliArgs(localAppArgsWithCapturedQuality(
        CAPTURED_QUALITY_FLAGS.filter(([flag]) => flag !== omittedFlag[0]),
      ))).toThrow("All four --captured-quality-* paths are required together.");
    }
    expect(() => parseFoundryCliArgs(localAppArgsWithCapturedQuality([
      CAPTURED_QUALITY_FLAGS[0],
    ]))).toThrow("All four --captured-quality-* paths are required together.");
  });

  it("rejects duplicate captured-quality flags and relative trusted paths", () => {
    const duplicate = CAPTURED_QUALITY_FLAGS[0];
    expect(() => parseFoundryCliArgs([
      ...localAppArgsWithCapturedQuality(),
      duplicate[0],
      duplicate[1],
    ])).toThrow(`Duplicate CLI option: ${duplicate[0]}.`);

    for (const [relativeFlag] of CAPTURED_QUALITY_FLAGS) {
      const flags = CAPTURED_QUALITY_FLAGS.map(([flag, value]) => [
        flag,
        flag === relativeFlag ? "relative-path" : value,
      ] as const);
      expect(() => parseFoundryCliArgs(localAppArgsWithCapturedQuality(flags)))
        .toThrow(`${relativeFlag} must be an absolute path.`);
    }
  });

  it("starts the legacy source app when Python resolution is unavailable", async () => {
    const startLocalApp = vi.fn(() => Promise.resolve(fakeApp()));
    const startNativeIntakeApp = vi.fn(() => Promise.resolve(fakeNativeIntakeApp()));
    const openLocalApp = vi.fn();
    const write = vi.fn<(text: string) => void>();
    const resolvePython = vi.fn(() => Promise.reject(new Error("Python is unavailable")));

    await runFoundryCli(["local-app", "--source", "capture-drop"], {
      env: {},
      write,
      startLocalApp,
      startNativeIntakeApp,
      openLocalApp,
      resolvePreparedHdPythonExecutable: resolvePython,
    });

    expect(startLocalApp).toHaveBeenCalledWith({
      source: "capture-drop",
      port: 0,
    });
    expect(startNativeIntakeApp).not.toHaveBeenCalled();
    expect(resolvePython).not.toHaveBeenCalled();
    expect(openLocalApp).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.stringContaining("1. Open this private local link"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("press Ctrl+C"));
  });

  it("dispatches the exact captured-quality trusted context with a process runner", async () => {
    const startLocalApp = vi.fn(() => Promise.resolve(fakeApp()));
    const resolvePython = vi.fn(() => Promise.reject(new Error("Python is unavailable")));

    await runFoundryCli(localAppArgsWithCapturedQuality(), {
      env: {},
      write: vi.fn(),
      startLocalApp,
      resolvePreparedHdPythonExecutable: resolvePython,
    });

    expect(startLocalApp).toHaveBeenCalledWith({
      source: "capture-drop",
      port: 0,
      capturedQualityComparison: {
        trustedContext: CAPTURED_QUALITY_TRUSTED_CONTEXT,
        runner: expect.any(Function),
      },
    });
    expect(resolvePython).not.toHaveBeenCalled();
  });

  it("reopens a verified workspace without requiring the original source", async () => {
    const startLocalApp = vi.fn(() => Promise.resolve(fakeApp()));
    const resolvePython = vi.fn(() => Promise.reject(new Error("Python is unavailable")));
    const verifyLocalIntakeWorkspace = vi.fn(() => Promise.resolve({
      activeSourcePath: FIXED_WORKSPACE_SOURCE,
    }));

    await runFoundryCli(["local-app", "--workspace", FIXED_WORKSPACE], {
      env: {},
      write: vi.fn(),
      startLocalApp,
      verifyLocalIntakeWorkspace,
      resolvePreparedHdPythonExecutable: resolvePython,
    });

    expect(verifyLocalIntakeWorkspace).toHaveBeenCalledWith(FIXED_WORKSPACE);
    expect(startLocalApp).toHaveBeenCalledWith({
      source: FIXED_WORKSPACE_SOURCE,
      port: 0,
      localIntakeWorkspace: {
        trustedContext: {
          sourceRoot: FIXED_WORKSPACE_SOURCE,
          workspaceDirectory: FIXED_WORKSPACE,
        },
      },
    });
    expect(resolvePython).not.toHaveBeenCalled();
  });

  it("does not opt the legacy local app into prepared-HD from the Python environment", async () => {
    const startLocalApp = vi.fn(() => Promise.resolve(fakeApp()));
    const resolvePython = vi.fn((env: NodeJS.ProcessEnv) =>
      Promise.resolve(env.PYTHON?.trim() ?? ""));

    await runFoundryCli(["local-app", "--source", "capture-drop"], {
      env: { PYTHON: "  C:\\Python313\\python.exe  " },
      write: vi.fn(),
      startLocalApp,
      resolvePreparedHdPythonExecutable: resolvePython,
    });

    expect(startLocalApp).toHaveBeenCalledWith({
      source: "capture-drop",
      port: 0,
    });
    expect(resolvePython).not.toHaveBeenCalled();
  });

  it("resolves and freezes one canonical interpreter before controller construction", async () => {
    const windowsStoreShim =
      "C:\\Users\\operator\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe";
    const fixedPython = "C:\\Python313\\python.exe";
    const locate = vi.fn(() => Promise.resolve([
      fixedPython,
      windowsStoreShim,
    ]));
    const canonicalize = vi.fn((path: string) => Promise.resolve(path));

    await expect(resolvePreparedHdPythonExecutable({}, {
      platform: "win32",
      locate,
      canonicalize,
    })).resolves.toBe(fixedPython);
    expect(locate).toHaveBeenCalledWith("python", {}, "win32");
    expect(canonicalize).toHaveBeenCalledWith(fixedPython);
    expect(canonicalize).toHaveBeenCalledWith(windowsStoreShim);
  });

  it("rejects a relative configured interpreter path and an empty locator result", async () => {
    await expect(resolvePreparedHdPythonExecutable(
      { PYTHON: ".\\python.exe" },
      {
        platform: "win32",
        locate: () => Promise.resolve([]),
        canonicalize: (path) => Promise.resolve(path),
      },
    )).rejects.toThrow("absolute path or one executable name");
    await expect(resolvePreparedHdPythonExecutable({}, {
      platform: "win32",
      locate: () => Promise.resolve([]),
      canonicalize: (path) => Promise.resolve(path),
    })).rejects.toThrow("fixed Python interpreter could not be found");
  });

  it("opens the internally generated URL only after --open is explicit", async () => {
    const app = fakeApp();
    const openLocalApp = vi.fn();
    await runFoundryCli(["local-app", "--source", "capture-drop", "--open"], {
      env: {},
      write: vi.fn(),
      startLocalApp: () => Promise.resolve(app),
      openLocalApp,
      resolvePreparedHdPythonExecutable: () =>
        Promise.reject(new Error("Python is unavailable")),
    });
    expect(openLocalApp).toHaveBeenCalledOnce();
    expect(openLocalApp).toHaveBeenCalledWith(app.url);
  });
});
