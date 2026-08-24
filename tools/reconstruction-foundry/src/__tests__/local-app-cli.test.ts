import { describe, expect, it, vi } from "vitest";
import { parseFoundryCliArgs, runFoundryCli } from "../cli.js";
import type { LocalFoundryAppHandle } from "../local-app.js";

function fakeApp(withCandidate = false): LocalFoundryAppHandle {
  const descriptorUrl = `http://127.0.0.1:43127/api/local-sog-candidate?token=${"a".repeat(43)}`;
  return {
    host: "127.0.0.1",
    port: 43_127,
    origin: "http://127.0.0.1:43127",
    url: `http://127.0.0.1:43127/?token=${"a".repeat(43)}`,
    ...(withCandidate
      ? {
          localSogCandidateDescriptorUrl: descriptorUrl,
          localSogCandidateConsumerUrl: `http://127.0.0.1:55979/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&localSogCandidate=${encodeURIComponent(descriptorUrl)}`,
        }
      : {}),
    sourceLabel: "capture-drop",
    closed: Promise.resolve({ reason: "programmatic" }),
    stop: () => Promise.resolve(),
    getPhase: () => "stopped",
  };
}

describe("Foundry local app CLI", () => {
  it("parses one fixed source, an optional loopback port, and an explicit open flag", () => {
    expect(
      parseFoundryCliArgs(["local-app", "--source", "C:\\capture drop"]),
    ).toEqual({
      kind: "local-app",
      source: "C:\\capture drop",
      port: 0,
      open: false,
    });
    expect(
      parseFoundryCliArgs([
        "local-app",
        "--open",
        "--port",
        "43127",
        "--source",
        "capture",
      ]),
    ).toEqual({
      kind: "local-app",
      source: "capture",
      port: 43_127,
      open: true,
    });
    expect(() =>
      parseFoundryCliArgs(["local-app", "--source", "capture", "--port", "80"]),
    ).toThrow("between 1024 and 65535");
    expect(() =>
      parseFoundryCliArgs([
        "local-app",
        "--source",
        "capture",
        "--path",
        "secret",
      ]),
    ).toThrow("Unknown CLI option");
    expect(() =>
      parseFoundryCliArgs([
        "local-app",
        "--source",
        "capture",
        "--open",
        "true",
      ]),
    ).toThrow("Unknown CLI option");
  });

  it("requires an explicit owner attestation for the exact local SOG candidate", () => {
    expect(
      parseFoundryCliArgs([
        "local-app",
        "--source",
        "C:\\capture drop",
        "--grand-hall-sog-manifest",
        "lcc2-result/Grand_Hall_Small.lcc2",
        "--owner-authorized-venviewer-product-use",
        "--candidate-consumer-origin",
        "http://127.0.0.1:55979",
      ]),
    ).toEqual({
      kind: "local-app",
      source: "C:\\capture drop",
      port: 0,
      open: false,
      localSogCandidate: {
        manifestRelativePath: "lcc2-result/Grand_Hall_Small.lcc2",
        ownerAuthorizedVenviewerProductUse: true,
        allowedConsumerOrigin: "http://127.0.0.1:55979",
      },
    });
    expect(() =>
      parseFoundryCliArgs([
        "local-app",
        "--source",
        "capture",
        "--grand-hall-sog-manifest",
        "lcc2-result/Grand_Hall_Small.lcc2",
      ]),
    ).toThrow("explicit --owner-authorized-venviewer-product-use attestation");
    expect(() =>
      parseFoundryCliArgs([
        "local-app",
        "--source",
        "capture",
        "--owner-authorized-venviewer-product-use",
      ]),
    ).toThrow("requires --grand-hall-sog-manifest");
    expect(() =>
      parseFoundryCliArgs([
        "local-app",
        "--source",
        "capture",
        "--candidate-consumer-origin",
        "http://127.0.0.1:55979",
      ]),
    ).toThrow("requires --grand-hall-sog-manifest");
    expect(() =>
      parseFoundryCliArgs([
        "local-app",
        "--source",
        "capture",
        "--grand-hall-sog-manifest",
        "lcc2-result/Grand_Hall_Small.lcc2",
        "--owner-authorized-local-product-use",
      ]),
    ).toThrow("local-only and cannot mint");
  });

  it("parses every multimodal root/file only behind the full-scope attestation", () => {
    expect(
      parseFoundryCliArgs([
        "local-app",
        "--source",
        "C:\\gh-small",
        "--grand-hall-sog-manifest",
        "lcc2-result/Grand_Hall_Small.lcc2",
        "--owner-authorized-venviewer-product-use",
        "--candidate-consumer-origin",
        "http://127.0.0.1:55983",
        "--grand-hall-twin-bundle",
        "C:\\twin",
        "--grand-hall-public-reference-images",
        "C:\\images",
        "--grand-hall-xgrids-raw",
        "F:\\raw",
        "--grand-hall-e57-stage",
        "F:\\stage",
        "--grand-hall-reference-video",
        "C:\\video.mov",
        "--grand-hall-captured-reference-image",
        "C:\\reference.jpg",
        "--grand-hall-generated-reference-image",
        "C:\\generated.png",
      ]),
    ).toMatchObject({
      localSogCandidate: {
        ownerAuthorizedVenviewerProductUse: true,
      },
      localRoomEvidence: {
        twinBundleRoot: "C:\\twin",
        ownerAuthorizedVenviewerProductUse: true,
        publicReferenceImageRoot: "C:\\images",
        xgridsRawRoot: "F:\\raw",
        e57StageRoot: "F:\\stage",
        referenceVideoPath: "C:\\video.mov",
        capturedReferenceImagePath: "C:\\reference.jpg",
        generatedReferenceImagePath: "C:\\generated.png",
      },
    });
    expect(() =>
      parseFoundryCliArgs([
        "local-app",
        "--source",
        "capture",
        "--grand-hall-twin-bundle",
        "C:\\twin",
        "--owner-authorized-local-product-use",
      ]),
    ).toThrow("local-only and cannot mint");
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

    expect(startLocalApp).toHaveBeenCalledWith({
      source: "capture-drop",
      port: 0,
    });
    expect(openLocalApp).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("1. Open this private local link"),
    );
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

  it("passes the exact candidate grant and prints a complete consumer URL", async () => {
    const app = fakeApp(true);
    const startLocalApp = vi.fn(() => Promise.resolve(app));
    const write = vi.fn<(text: string) => void>();
    await runFoundryCli(
      [
        "local-app",
        "--source",
        "C:\\capture drop",
        "--grand-hall-sog-manifest",
        "lcc2-result/Grand_Hall_Small.lcc2",
        "--owner-authorized-venviewer-product-use",
        "--candidate-consumer-origin",
        "http://127.0.0.1:55979",
      ],
      {
        env: {},
        write,
        startLocalApp,
      },
    );

    expect(startLocalApp).toHaveBeenCalledWith({
      source: "C:\\capture drop",
      port: 0,
      localSogCandidate: {
        manifestRelativePath: "lcc2-result/Grand_Hall_Small.lcc2",
        ownerAuthorizedVenviewerProductUse: true,
        allowedConsumerOrigin: "http://127.0.0.1:55979",
      },
    });
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("localSogCandidate="),
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("/dev/trades-hall-visual?"),
    );
  });

  it("passes the multimodal grant and prints its complete localRoomEvidence consumer URL", async () => {
    const base = fakeApp(true);
    const descriptorUrl = `http://127.0.0.1:43127/api/local-room-evidence-candidate?token=${"a".repeat(43)}`;
    const app: LocalFoundryAppHandle = {
      ...base,
      localRoomEvidenceDescriptorUrl: descriptorUrl,
      localRoomEvidenceConsumerUrl: `http://127.0.0.1:55983/dev/trades-hall-visual?venue=trades-hall&room=grand-hall&localRoomEvidence=${encodeURIComponent(descriptorUrl)}`,
    };
    const startLocalApp = vi.fn(() => Promise.resolve(app));
    const write = vi.fn<(text: string) => void>();
    await runFoundryCli(
      [
        "local-app",
        "--source",
        "C:\\gh-small",
        "--grand-hall-sog-manifest",
        "lcc2-result/Grand_Hall_Small.lcc2",
        "--owner-authorized-venviewer-product-use",
        "--candidate-consumer-origin",
        "http://127.0.0.1:55983",
        "--grand-hall-twin-bundle",
        "C:\\twin",
      ],
      { env: {}, write, startLocalApp },
    );

    expect(startLocalApp).toHaveBeenCalledWith(
      expect.objectContaining({
        localRoomEvidence: expect.objectContaining({
          twinBundleRoot: "C:\\twin",
          ownerAuthorizedVenviewerProductUse: true,
        }),
      }),
    );
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("localRoomEvidence="),
    );
  });
});
