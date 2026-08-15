import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Group } from "three";
import { describe, expect, it } from "vitest";

import { readImg2ThreeSculptRuntime } from "../../../../lib/furniture-presentation-runtime.js";
import { createBanquetChairProxy } from "../createBanquetChairProxy.js";
import { createBarCounterProxy } from "../createBarCounterProxy.js";
import { createDanceFloorPanelProxy } from "../createDanceFloorPanelProxy.js";
import { createLaptopProxy } from "../createLaptopProxy.js";
import { createLecternProxy } from "../createLecternProxy.js";
import { createMicrophoneProxy } from "../createMicrophoneProxy.js";
import { createMicStandProxy } from "../createMicStandProxy.js";
import { createPlatformNarrowProxy } from "../createPlatformNarrowProxy.js";
import { createPlatformProxy } from "../createPlatformProxy.js";
import {
  createPoseurTableBlackProxy,
  createPoseurTableWhiteProxy,
} from "../createPoseurTableClothProxy.js";
import { createPoseurTableProxy } from "../createPoseurTableProxy.js";
import { createProjectorProxy } from "../createProjectorProxy.js";
import { createProjectorScreenProxy } from "../createProjectorScreenProxy.js";
import { createRoundTableProxy } from "../createRoundTableProxy.js";
import { createTrestle4ftProxy } from "../createTrestle4ftProxy.js";
import { createTrestleTableProxy } from "../createTrestleTableProxy.js";
import { createGeneratedFurniturePartManifest } from "../generatedFurniturePartManifest.js";
import { GENERATED_FURNITURE_SLUGS } from "../generatedFurnitureRegistry.js";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../../../../../..");

const FIXTURES = [
  {
    model: "banquet-chair",
    factory: createBanquetChairProxy,
    requiredParts: [
      "seat-pad",
      "backrest-pad",
      "back-frame-loop",
      "front-left-leg",
      "front-right-leg",
      "rear-left-leg",
      "rear-right-leg",
      "front-leg-pair",
      "rear-leg-pair",
      "lateral-brace-pair",
      "underseat-frame",
      "foot-cap-system",
    ],
  },
  {
    model: "round-table-6ft",
    factory: createRoundTableProxy,
    requiredParts: [
      "root",
      "tabletop",
      "trestle-a",
      "trestle-b",
      "front-left-leg",
      "rear-left-leg",
      "front-right-leg",
      "rear-right-leg",
      "brace-set-a",
      "brace-set-b",
      "hinge-plate-a",
      "hinge-plate-b",
      "cleat-a",
      "cleat-b",
      "pivot-tab-a",
      "pivot-tab-b",
      "frame-crossbar",
      "hinge-fastener-system",
    ],
  },
  {
    model: "trestle-6ft",
    factory: createTrestleTableProxy,
    requiredParts: [
      "tabletop",
      "left-trestle",
      "right-trestle",
      "left-front-upright",
      "left-rear-upright",
      "right-front-upright",
      "right-rear-upright",
      "left-floor-bar",
      "right-floor-bar",
      "stretcher",
      "brace-system",
      "foot-system",
      "fastener-system",
    ],
  },
  {
    model: "platform",
    factory: createPlatformProxy,
    requiredParts: [
      "deck-panel",
      "perimeter-frame",
      "leg-system",
      "front-rail",
      "rear-rail",
      "left-rail",
      "right-rail",
      "front-left-upright",
      "front-right-upright",
      "rear-left-upright",
      "rear-right-upright",
      "brace-system",
      "corner-lock-system",
      "foot-system",
    ],
  },
  {
    model: "bar-counter",
    factory: createBarCounterProxy,
    requiredParts: [
      "countertop",
      "cabinet-shell",
      "front-panel-system",
      "corner-post-system",
      "staff-side-bay",
      "base-plinth",
      "foot-rail-system",
      "front-panel-left",
      "front-panel-centre",
      "front-panel-right",
      "front-left-post",
      "front-right-post",
      "rear-left-post",
      "left-return",
      "right-return",
      "service-shelf",
      "rail-bracket-system",
      "accent-hardware",
    ],
  },
  {
    model: "dancefloor-panel",
    factory: createDanceFloorPanelProxy,
    requiredParts: [
      "deck",
      "parquet-field",
      "subframe",
      "subframe-ribs",
      "corner-locks",
      "lock-hardware",
    ],
  },
  {
    model: "projector-screen",
    factory: createProjectorScreenProxy,
    requiredParts: [
      "screen-surface",
      "top-frame-rail",
      "bottom-frame-rail",
      "left-frame-rail",
      "right-frame-rail",
      "left-lower-post",
      "right-lower-post",
      "left-base-rail",
      "right-base-rail",
      "left-front-brace",
      "left-rear-brace",
      "right-front-brace",
      "right-rear-brace",
      "frame",
      "screen",
      "supports",
      "hardware",
    ],
  },
  {
    model: "lectern",
    factory: createLecternProxy,
    requiredParts: [
      "lower-plinth",
      "upper-plinth",
      "lower-plinth-moulding",
      "upper-plinth-moulding",
      "cabinet-shell",
      "cabinet-left-side",
      "cabinet-right-side",
      "cabinet-back",
      "cabinet-header",
      "lower-front-backing",
      "shelf-recess",
      "front-panel-field",
      "front-panel-frame",
      "front-panel-moulding",
      "reading-deck",
      "deck-left-rail",
      "deck-right-rail",
      "deck-retaining-rail",
      "cable-grommet",
      "plinth-assembly",
      "cabinet-assembly",
      "public-panel-assembly",
      "deck-assembly",
      "deck-rails",
    ],
  },
  {
    model: "projector",
    factory: createProjectorProxy,
    requiredParts: [
      "chassis-shell",
      "front-fascia",
      "top-shell",
      "optical-assembly",
      "front-vent-system",
      "front-right-vent",
      "side-vent-system",
      "rear-connector-recess",
      "foot-system",
      "front-right-foot",
      "rear-left-foot",
      "rear-right-foot",
      "shell",
      "optics",
      "ventilation",
      "feet",
      "rear-detail",
    ],
  },
  {
    model: "trestle-4ft",
    factory: createTrestle4ftProxy,
    requiredParts: [
      "tabletop",
      "support-stations",
      "left-support",
      "right-support",
      "left-underside-rail",
      "right-underside-rail",
      "left-front-upright",
      "left-rear-upright",
      "right-front-upright",
      "right-rear-upright",
      "left-floor-bar",
      "right-floor-bar",
      "stretcher",
      "brace-system",
      "foot-system",
      "fastener-system",
    ],
  },
  {
    model: "platform-narrow",
    factory: createPlatformNarrowProxy,
    requiredParts: [
      "deck-panel",
      "deck-assembly",
      "perimeter-frame",
      "leg-system",
      "front-rail",
      "rear-rail",
      "left-rail",
      "right-rail",
      "front-left-upright",
      "front-centre-upright",
      "front-right-upright",
      "rear-left-upright",
      "rear-centre-upright",
      "rear-right-upright",
      "brace-system",
      "corner-lock-system",
      "foot-system",
    ],
  },
  {
    model: "poseur-table",
    factory: createPoseurTableProxy,
    requiredParts: [
      "tabletop",
      "top-surface",
      "rolled-rim",
      "underside-band",
      "underplate",
      "pedestal",
      "upper-collar",
      "pedestal-column",
      "lower-collar",
      "star-base",
      "central-hub",
      "arm-north",
      "arm-east",
      "arm-south",
      "arm-west",
      "levelling-feet",
      "foot-pad-north",
      "foot-pad-west",
    ],
  },
  {
    model: "laptop",
    factory: createLaptopProxy,
    requiredParts: [
      "base-assembly",
      "base-shell",
      "upper-deck",
      "trackpad",
      "keyboard-bed",
      "keyboard-key-system",
      "foot-system",
      "left-port-system",
      "hinge-system",
      "display-assembly",
      "display-shell",
      "bezel",
      "screen-surface",
      "display",
      "hinges",
      "input-deck",
    ],
  },
  {
    model: "mic-stand",
    factory: createMicStandProxy,
    requiredParts: [
      "boom-assembly",
      "boom-hinge-body",
      "boom-slide-collar",
      "boom-tube",
      "collar-grip-rib-system",
      "empty-clip-cradle",
      "empty-clip-jaw-system",
      "empty-clip-left-jaw",
      "empty-clip-right-jaw",
      "empty-microphone-clip",
      "hinge-axle",
      "hinge-axle-system",
      "leg-root-hardware-system",
      "lower-upright-pole",
      "rear-counterweight-sleeve",
      "telescoping-lock-collar",
      "terminal-adapter",
      "tripod-base-assembly",
      "tripod-foot-front-left",
      "tripod-foot-front-right",
      "tripod-foot-rear",
      "tripod-foot-system",
      "tripod-hub",
      "tripod-hub-lower-collar",
      "tripod-hub-shell",
      "tripod-leg-front-left",
      "tripod-leg-front-right",
      "tripod-leg-rear",
      "tripod-leg-system",
      "upper-upright-pole",
      "upright-assembly",
    ],
  },
  {
    model: "microphone",
    factory: createMicrophoneProxy,
    requiredParts: [
      "base-assembly",
      "capsule",
      "capsule-assembly",
      "capsule-barrel",
      "capsule-rear-collar",
      "capsule-transition-collar",
      "controls",
      "gooseneck",
      "gooseneck-assembly",
      "gooseneck-core",
      "gooseneck-rib-system",
      "grille-face",
      "grille-ring",
      "lower-base-plinth",
      "mute-switch",
      "neck-gland",
      "rubber-foot-system",
      "upper-base-shell",
      "weighted-base",
    ],
  },
  {
    model: "poseur-table-black",
    factory: createPoseurTableBlackProxy,
    requiredParts: [
      "cover-assembly",
      "anchor-pad-front-left",
      "anchor-pad-front-right",
      "anchor-pad-rear-right",
      "anchor-pad-rear-left",
      "cloth-cover",
      "cloth-relief",
      "floor-pad-system",
    ],
  },
  {
    model: "poseur-table-white",
    factory: createPoseurTableWhiteProxy,
    requiredParts: [
      "cover-assembly",
      "anchor-pad-front-left",
      "anchor-pad-front-right",
      "anchor-pad-rear-right",
      "anchor-pad-rear-left",
      "cloth-cover",
      "cloth-relief",
      "floor-pad-system",
    ],
  },
] as const;

describe("generated furniture part manifests", () => {
  it("covers every generated registry slug exactly once", () => {
    expect(FIXTURES.map(({ model }) => model).sort()).toEqual(
      [...GENERATED_FURNITURE_SLUGS].sort(),
    );
  });

  for (const fixture of FIXTURES) {
    it(`dumps real selectable parts and assemblies for ${fixture.model}`, () => {
      const root = fixture.factory();
      const manifest = createGeneratedFurniturePartManifest(fixture.model, root);
      const repeatedManifest = createGeneratedFurniturePartManifest(
        fixture.model,
        fixture.factory(),
      );
      const runtime = readImg2ThreeSculptRuntime(root);
      const names = manifest.parts.map(({ name }) => name);

      expect(manifest.schemaVersion).toBe("venviewer.img2threejs-parts.v1");
      expect(manifest.model).toBe(fixture.model);
      expect(manifest.unnamedMeshes).toBe(0);
      expect(manifest.integralMeshes).toBeGreaterThanOrEqual(
        fixture.model === "poseur-table" ? 0 : 1,
      );
      expect(new Set(names).size).toBe(names.length);
      expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
      expect(manifest.parts.every(({ triangles }) => triangles > 0)).toBe(true);
      expect(repeatedManifest).toEqual(manifest);
      for (const partId of fixture.requiredParts) expect(names).toContain(partId);

      const assemblies = manifest.parts.filter(({ kind }) => kind === "assembly");
      expect(assemblies.every(({ members }) => (members?.length ?? 0) > 0)).toBe(true);
      for (const part of manifest.parts) {
        if (part.kind === "part") expect(runtime.nodes[part.name]).toBeDefined();
        else expect(runtime.destructionGroups[part.name]).toBeDefined();
      }
      expect(() => JSON.parse(JSON.stringify(manifest)) as unknown).not.toThrow();
      const persisted = JSON.parse(readFileSync(resolve(
        REPOSITORY_ROOT,
        "artifacts",
        "img2threejs",
        fixture.model,
        "parts.json",
      ), "utf8")) as unknown;
      expect(persisted).toEqual(manifest);
    });
  }

  it("refuses an empty model identity", () => {
    expect(() => createGeneratedFurniturePartManifest("  ", new Group()))
      .toThrowError("part manifest model must not be empty");
  });

  it("counts all factory-owned microphone instances in parts and assemblies", () => {
    const manifest = createGeneratedFurniturePartManifest(
      "microphone",
      createMicrophoneProxy(),
    );
    const trianglesByName = new Map(
      manifest.parts.map(({ name, triangles }) => [name, triangles]),
    );

    expect(trianglesByName.get("rubber-foot-system")).toBe(1_200);
    expect(trianglesByName.get("gooseneck-rib-system")).toBe(7_680);
    expect(trianglesByName.get("weighted-base")).toBe(2_932);
    expect(trianglesByName.get("gooseneck")).toBe(10_752);
    expect(trianglesByName.get("capsule")).toBe(2_544);
  });
});
