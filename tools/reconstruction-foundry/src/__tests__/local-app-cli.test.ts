import { describe, expect, it, vi } from "vitest";
import { parseFoundryCliArgs, runFoundryCli } from "../cli.js";
import type { LocalFoundryAppHandle } from "../local-app.js";

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

describe("Foundry local app CLI", () => {
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

  it("does not open a browser unless the operator supplied --open", async () => {
    const startLocalApp = vi.fn(() => Promise.resolve(fakeApp()));
    const openLocalApp = vi.fn();
    const write = vi.fn<(text: string) => void>();

    await runFoundryCli(["local-app", "--source", "capture-drop"], {
      env: {},
      write,
      startLocalApp,
      openLocalApp,
    });

    expect(startLocalApp).toHaveBeenCalledWith({ source: "capture-drop", port: 0 });
    expect(openLocalApp).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.stringContaining("1. Open this private local link"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("press Ctrl+C"));
  });

  it("opens the internally generated URL only after --open is explicit", async () => {
    const app = fakeApp();
    const openLocalApp = vi.fn();
    await runFoundryCli(["local-app", "--source", "capture-drop", "--open"], {
      env: {},
      write: vi.fn(),
      startLocalApp: () => Promise.resolve(app),
      openLocalApp,
    });
    expect(openLocalApp).toHaveBeenCalledOnce();
    expect(openLocalApp).toHaveBeenCalledWith(app.url);
  });
});
