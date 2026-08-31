import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_HARDWARE_BROWSER_CANDIDATES,
  GRAND_HALL_HARDWARE_BROWSER_PROFILE_SCHEMA,
  GRAND_HALL_HARDWARE_LAUNCH_ARGUMENTS,
  assertGrandHallBrowserVersionMatchesProfile,
  assertGrandHallHardwareEvidenceMatchesProfile,
  grandHallHardwarePreflightEvidenceMarker,
  parseGrandHallHardwareBrowserProfile,
  selectGrandHallHardwareBrowserProfile,
  serializeGrandHallHardwareBrowserProfile,
  type GrandHallHardwareProbeEvidence,
} from "./grand-hall-browser-hardware.js";

const HARDWARE_EVIDENCE = Object.freeze({
  browserVersion: "151.0.7922.175",
  userAgent: "Mozilla/5.0 HeadlessChrome/151.0.0.0",
  webglVendor: "Google Inc. (NVIDIA)",
  webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090, D3D11)",
  webglVersion: "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
  contextLost: false,
  probeDurationMs: 618,
} satisfies GrandHallHardwareProbeEvidence);

describe("Grand Hall hardware browser selection", () => {
  it("pins D3D11 and disables software-rasterizer fallback", () => {
    expect(GRAND_HALL_HARDWARE_LAUNCH_ARGUMENTS).toEqual([
      "--use-angle=d3d11",
      "--disable-software-rasterizer",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion",
      "--force-device-scale-factor=1",
    ]);
    expect(GRAND_HALL_HARDWARE_BROWSER_CANDIDATES[0]).toMatchObject({
      browserName: "chromium",
      channel: "chrome",
      headless: true,
    });
  });

  it("skips failed and software candidates, then selects explicit hardware", async () => {
    const attempts: GrandHallHardwareProbeEvidence[] = [
      {
        ...HARDWARE_EVIDENCE,
        webglVendor: "Google Inc. (Google)",
        webglRenderer: "ANGLE (Google, SwiftShader Device (Subzero), SwiftShader driver)",
      },
      HARDWARE_EVIDENCE,
    ];
    let probeIndex = 0;
    const selected = await selectGrandHallHardwareBrowserProfile(
      GRAND_HALL_HARDWARE_BROWSER_CANDIDATES.slice(0, 2),
      () => Promise.resolve(attempts[probeIndex++] ?? HARDWARE_EVIDENCE),
    );

    expect(selected.profile).toMatchObject({
      schemaVersion: GRAND_HALL_HARDWARE_BROWSER_PROFILE_SCHEMA,
      candidateId: GRAND_HALL_HARDWARE_BROWSER_CANDIDATES[1]?.candidateId,
      webglRenderer: HARDWARE_EVIDENCE.webglRenderer,
    });
    expect(selected.attempts.map((attempt) => attempt.outcome)).toEqual([
      "rejected_software",
      "selected_hardware",
    ]);
  });

  it("fails closed when no candidate proves hardware WebGL", async () => {
    await expect(selectGrandHallHardwareBrowserProfile(
      GRAND_HALL_HARDWARE_BROWSER_CANDIDATES.slice(0, 2),
      () => Promise.resolve({
        ...HARDWARE_EVIDENCE,
        webglVendor: "WebKit",
        webglRenderer: "WebKit WebGL",
      }),
    )).rejects.toThrow(/no candidate produced explicit hardware WebGL/u);
  });

  it("round-trips only a known launch profile and rejects SwiftShader launch injection", async () => {
    const selected = await selectGrandHallHardwareBrowserProfile(
      GRAND_HALL_HARDWARE_BROWSER_CANDIDATES.slice(0, 1),
      () => Promise.resolve(HARDWARE_EVIDENCE),
    );
    const serialized = serializeGrandHallHardwareBrowserProfile(selected.profile);
    expect(parseGrandHallHardwareBrowserProfile(serialized)).toEqual(selected.profile);

    const tampered = JSON.stringify({
      ...selected.profile,
      launchArgs: ["--use-angle=swiftshader"],
    });
    expect(() => parseGrandHallHardwareBrowserProfile(tampered)).toThrow(
      /known fail-closed launch candidate/u,
    );
  });

  it("requires the worker preflight to reproduce the selected hardware identity", async () => {
    const selected = await selectGrandHallHardwareBrowserProfile(
      GRAND_HALL_HARDWARE_BROWSER_CANDIDATES.slice(0, 1),
      () => Promise.resolve(HARDWARE_EVIDENCE),
    );
    expect(() => {
      assertGrandHallHardwareEvidenceMatchesProfile(selected.profile, HARDWARE_EVIDENCE);
    }).not.toThrow();
    expect(() => {
      assertGrandHallBrowserVersionMatchesProfile(selected.profile, HARDWARE_EVIDENCE.browserVersion);
    }).not.toThrow();
    expect(() => {
      assertGrandHallBrowserVersionMatchesProfile(selected.profile, "152.0.0.0");
    }).toThrow(/browser version/u);
    expect(() => {
      assertGrandHallHardwareEvidenceMatchesProfile(selected.profile, {
        ...HARDWARE_EVIDENCE,
        webglRenderer: "ANGLE (Google, SwiftShader Device (Subzero), SwiftShader driver)",
      });
    }).toThrow(/requires explicit hardware WebGL/u);
  });

  it("marks preflight evidence as complete before any source navigation", async () => {
    const selected = await selectGrandHallHardwareBrowserProfile(
      GRAND_HALL_HARDWARE_BROWSER_CANDIDATES.slice(0, 1),
      () => Promise.resolve(HARDWARE_EVIDENCE),
    );
    const marker = grandHallHardwarePreflightEvidenceMarker({
      profileSha256: `sha256:${"a".repeat(64)}`,
      browserVersion: selected.profile.browserVersion,
      evidence: HARDWARE_EVIDENCE,
    });
    expect(marker).toContain("VENVIEWER_BROWSER_HARDWARE_PREFLIGHT_V1:");
    expect(marker).toContain('"completedBeforeSourceNavigation":true');
    expect(marker).toContain('"browserVersion":"151.0.7922.175"');
    expect(marker).toContain(selected.profile.webglRenderer);
  });
});
