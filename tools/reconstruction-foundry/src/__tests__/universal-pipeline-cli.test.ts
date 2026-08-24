import { describe, expect, it, vi } from "vitest";
import { parseFoundryCliArgs, runFoundryCli } from "../cli.js";

describe("universal Foundry pipeline CLI reachability", () => {
  it("parses the latest source-facts, bundle-composition, and package-assembly commands strictly", () => {
    expect(
      parseFoundryCliArgs([
        "inspect-source-facts",
        "--source",
        "F:\\capture-bundle",
      ]),
    ).toEqual({
      kind: "inspect-source-facts",
      source: "F:\\capture-bundle",
    });
    expect(
      parseFoundryCliArgs([
        "compose-capture-bundle",
        "--input",
        "bundle-input.json",
      ]),
    ).toEqual({
      kind: "compose-capture-bundle",
      input: "bundle-input.json",
    });
    expect(
      parseFoundryCliArgs([
        "assess-adapters",
        "--manifest",
        "manifest.json",
        "--host",
        "host.json",
      ]),
    ).toEqual({
      kind: "assess-adapters",
      manifest: "manifest.json",
      host: "host.json",
    });
    expect(
      parseFoundryCliArgs([
        "assemble-room-package",
        "--input",
        "assembly-input.json",
      ]),
    ).toEqual({
      kind: "assemble-room-package",
      input: "assembly-input.json",
    });

    expect(() =>
      parseFoundryCliArgs([
        "inspect-source-facts",
        "--source",
        "capture",
        "--out",
        "forbidden",
      ]),
    ).toThrowError(/Unknown CLI option/u);
    expect(() => parseFoundryCliArgs(["compose-capture-bundle"])).toThrowError(
      /Missing required CLI option/u,
    );
  });

  it("routes source-facts inspection without substituting the receipt-only inspector", async () => {
    const inspectSourceFacts = vi.fn((source: string) =>
      Promise.resolve({
        schemaVersion: "omnitwin.foundry.universal-source-facts.v6",
        source,
        authority: "none",
      }),
    );
    const inspectIntake = vi.fn(() => Promise.resolve({ wrong: true }));
    const writes: string[] = [];

    await runFoundryCli(
      ["inspect-source-facts", "--source", "F:\\grand-hall"],
      {
        env: {},
        write: (text) => writes.push(text),
        inspectSourceFacts,
        inspectIntake,
      },
    );

    expect(inspectSourceFacts).toHaveBeenCalledOnce();
    expect(inspectSourceFacts).toHaveBeenCalledWith("F:\\grand-hall");
    expect(inspectIntake).not.toHaveBeenCalled();
    expect(JSON.parse(writes.join(""))).toMatchObject({
      schemaVersion: "omnitwin.foundry.universal-source-facts.v6",
      authority: "none",
    });
  });

  it("routes composition and package assembly as separate authority-none steps", async () => {
    const composeCaptureBundle = vi.fn((path: string) =>
      Promise.resolve({
        step: "capture_bundle",
        inputPath: path,
        authority: "none",
      }),
    );
    const assembleRoomPackage = vi.fn((path: string) =>
      Promise.resolve({
        step: "room_reality_package",
        inputPath: path,
        authority: "none",
        status: "blocked",
      }),
    );
    const writes: string[] = [];
    const dependencies = {
      env: {},
      write: (text: string): void => {
        writes.push(text);
      },
      composeCaptureBundle,
      assembleRoomPackage,
    };

    await runFoundryCli(
      ["compose-capture-bundle", "--input", "two-roots.json"],
      dependencies,
    );
    await runFoundryCli(
      ["assemble-room-package", "--input", "grand-hall-package.json"],
      dependencies,
    );

    expect(composeCaptureBundle).toHaveBeenCalledWith("two-roots.json");
    expect(assembleRoomPackage).toHaveBeenCalledWith("grand-hall-package.json");
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      step: "capture_bundle",
      authority: "none",
    });
    expect(JSON.parse(writes[1] ?? "{}")).toMatchObject({
      step: "room_reality_package",
      status: "blocked",
      authority: "none",
    });
  });

  it("routes adapter assessment with separate manifest and injected host evidence", async () => {
    const assessAdapters = vi.fn(
      (input: { readonly manifestPath: string; readonly hostPath: string }) =>
        Promise.resolve({
          step: "adapter_honesty_gate",
          ...input,
          authority: "none",
          execution: "not_authorized",
        }),
    );
    const writes: string[] = [];

    await runFoundryCli(
      [
        "assess-adapters",
        "--manifest",
        "grand-hall-manifest.json",
        "--host",
        "this-workstation.json",
      ],
      {
        env: {},
        write: (text) => writes.push(text),
        assessAdapters,
      },
    );

    expect(assessAdapters).toHaveBeenCalledWith({
      manifestPath: "grand-hall-manifest.json",
      hostPath: "this-workstation.json",
    });
    expect(JSON.parse(writes.join(""))).toMatchObject({
      step: "adapter_honesty_gate",
      authority: "none",
      execution: "not_authorized",
    });
  });
});
