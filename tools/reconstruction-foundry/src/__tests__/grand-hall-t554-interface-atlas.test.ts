import { createHash } from "node:crypto";
import {
  cpSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildT554InterfaceAtlas,
  checkT554InterfaceAtlasExactRegeneration,
  computeT554InterfaceAtlasManifestSha256,
  GRAND_HALL_T554_INTERFACE_ATLAS_SCHEMA,
  GRAND_HALL_T554_INTERFACE_DEFINITIONS,
  readStableT554InterfaceAtlasFile,
  verifyPersistedT554InterfaceAtlas,
  writeT554InterfaceAtlas,
  type T554InterfaceAtlasBuildInputs,
  type T554InterfaceAtlasPack,
} from "../grand-hall-t554-interface-atlas.js";
import {
  GRAND_HALL_T554_INTERFACE_ATLAS_USAGE,
  parseGrandHallT554InterfaceAtlasArguments,
} from "../grand-hall-t554-interface-atlas-cli.js";

type MutableRecord = Record<string, unknown>;

function syntheticObj(): string {
  const definitions = GRAND_HALL_T554_INTERFACE_DEFINITIONS;
  const vertices: string[] = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const x = index * 3;
    vertices.push(
      `v ${String(x)} 0 0`,
      `v ${String(x + 1)} 0 0`,
      `v ${String(x)} 1 1`,
      `v ${String(x + 0.5)} -1 0.5`,
    );
  }
  const faces: string[] = ["g chunk000_group001_sub009", "usemtl room9.jpg"];
  for (let index = 0; index < definitions.length; index += 1) {
    const first = index * 4 + 1;
    faces.push(`f ${String(first)} ${String(first + 1)} ${String(first + 2)}`);
  }
  definitions.forEach((definition, index) => {
    const first = index * 4 + 1;
    const serial = String(index + 1).padStart(3, "0");
    faces.push(
      `g chunk${serial}_group${String(definition.roomB.groupIndex).padStart(3, "0")}_sub${String(definition.roomB.subIndex).padStart(3, "0")}`,
      `usemtl adjacent-${serial}.jpg`,
      `f ${String(first)} ${String(first + 1)} ${String(first + 3)}`,
    );
  });
  return `${vertices.join("\n")}\n${faces.join("\n")}\n`;
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function inputs(): T554InterfaceAtlasBuildInputs {
  return inputsForObjText(syntheticObj());
}

function inputsForObjText(objText: string): T554InterfaceAtlasBuildInputs {
  const bytes = new TextEncoder().encode(objText);
  return {
    sourceObj: {
      sourceLocator: "MATTERPAK_SOURCE_ROOT/synthetic.obj",
      byteLength: bytes.byteLength,
      sha256: digest(bytes),
    },
    objText,
  };
}

function record(value: unknown, label: string): MutableRecord {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as MutableRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function cloneManifest(pack: T554InterfaceAtlasPack): MutableRecord {
  return record(JSON.parse(JSON.stringify(pack.manifest)), "cloned manifest");
}

function resealManifest(manifest: MutableRecord): void {
  delete manifest.manifestSha256;
  manifest.manifestSha256 = computeT554InterfaceAtlasManifestSha256(manifest as never);
}

function writePack(directory: string, pack: T554InterfaceAtlasPack): void {
  for (const [fileName, text] of pack.files) writeFileSync(join(directory, fileName), text, "utf8");
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(pack.manifest, null, 2)}\n`, "utf8");
}

function overwriteManifest(directory: string, manifest: MutableRecord): void {
  resealManifest(manifest);
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function withTemporaryDirectory(run: (directory: string) => void): void {
  const prefix = join(tmpdir(), "omnitwin-t554-interface-atlas-");
  const directory = mkdtempSync(prefix);
  if (!directory.startsWith(prefix)) throw new Error("temporary directory escaped its expected root");
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function mutateFirstInterface(
  manifest: MutableRecord,
  mutate: (item: MutableRecord) => void,
): void {
  const interfaces = array(manifest.interfaces, "interfaces");
  mutate(record(interfaces[0], "first interface"));
}

function updateOutputReceipt(manifest: MutableRecord, fileName: string, bytes: Uint8Array): void {
  const outputs = array(manifest.outputs, "outputs");
  const output = outputs
    .map((item, index) => record(item, `output ${String(index)}`))
    .find((item) => item.relativePath === fileName);
  if (output === undefined) throw new Error("output receipt is absent");
  output.byteLength = bytes.byteLength;
  output.sha256 = digest(bytes);
}

describe("T-554 eight-interface source-topology atlas", () => {
  it("deterministically emits exactly eight authority-none source-only SVGs", () => {
    const first = buildT554InterfaceAtlas(inputs());
    const second = buildT554InterfaceAtlas(inputs());
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect([...second.files]).toEqual([...first.files]);
    expect(first.files.size).toBe(8);
    expect([...first.files.keys()]).toEqual(
      GRAND_HALL_T554_INTERFACE_DEFINITIONS.map(
        (definition) => `interface-${definition.interfaceId}.svg`,
      ),
    );
    for (const [fileName, svg] of first.files) {
      expect(svg).toContain("AUTHORITY NONE · HUMAN REVIEW PENDING · SOURCE TRIANGLES ONLY");
      expect(svg).toContain("XY exact source projection");
      expect(svg).toContain("XZ exact source projection");
      expect(svg).toContain("YZ exact source projection");
      expect(svg).toContain("data-source-face-ordinal=");
      expect(svg).toContain("data-source-vertex-index=");
      expect(svg).toContain("data-source-edge=");
      expect(svg).toContain("data-room9-boundary-edge=");
      expect(svg).toContain("face ordinal digest:");
      expect(fileName).toMatch(/^interface-matterpak-1-9-/u);
      expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(
        /<script|foreignObject|href=|[A-Za-z]:[\\/]/iu,
      );
    }
    const manifest = record(first.manifest, "manifest");
    expect(manifest.schemaVersion).toBe(GRAND_HALL_T554_INTERFACE_ATLAS_SCHEMA);
    expect(manifest.authority).toEqual({
      state: "none",
      reviewState: "human_pending",
      interfaceDecisionsAccepted: false,
      closurePlaneAuthored: false,
      keepSideDecisionMade: false,
      cameraJoinAuthored: false,
      maskAuthored: false,
      repairedContourAuthored: false,
      inferredPortalOrDoorwayAuthored: false,
      generatedGeometryUsed: false,
      trainingAuthority: false,
      runtimeAuthority: false,
      structuralAuthority: false,
      exportAuthority: false,
    });
    expect(array(manifest.interfaces, "interfaces").map((item) => record(item, "interface").interfaceId)).toEqual(
      GRAND_HALL_T554_INTERFACE_DEFINITIONS.map((item) => item.interfaceId),
    );
    for (const item of array(manifest.interfaces, "interfaces")) {
      const interfaceRecord = record(item, "interface");
      expect(interfaceRecord.reviewState).toBe("human_pending");
      expect(interfaceRecord.disposition).toBeNull();
    }
  });

  it("rejects a source inventory with an omitted, extra, or substituted interface", () => {
    const original = syntheticObj();
    const omitted = original.replace(/g chunk008_group001_sub014[\s\S]*$/u, "");
    const extra = `${original}g chunk099_group002_sub099\nf 1 2 4\n`;
    const substituted = original.replace("group001_sub014", "group002_sub099");
    for (const objText of [omitted, extra, substituted]) {
      expect(() => buildT554InterfaceAtlas(inputsForObjText(objText))).toThrow(/exact canonical eight/u);
    }
  });

  it("rejects coordinate-tampered OBJ text that still claims the prior exact receipt", () => {
    const original = inputs();
    const changed = original.objText.replace("v 0 0 0", "v 0.125 0 0");
    expect(changed).not.toBe(original.objText);
    expect(() => buildT554InterfaceAtlas({ ...original, objText: changed })).toThrow(
      /differs from its exact source receipt/u,
    );
  });

  it("rejects Windows, UNC, and POSIX absolute source locators at build entry", () => {
    for (const sourceLocator of [
      "C:\\Users\\operator\\source.obj",
      "\\\\server\\share\\source.obj",
      "/home/operator/source.obj",
    ]) {
      const original = inputs();
      expect(() => buildT554InterfaceAtlas({
        ...original,
        sourceObj: { ...original.sourceObj, sourceLocator },
      })).toThrow(/exact source receipt/u);
    }
  });

  it("rejects operator-path material names while building source evidence", () => {
    const objText = syntheticObj().replace("usemtl room9.jpg", "usemtl C:\\Users\\operator\\secret.jpg");
    expect(() => buildT554InterfaceAtlas(inputsForObjText(objText))).toThrow(
      /source material name is unsafe/u,
    );
  });

  it("uses one pixels-per-metre scale within each exact metric projection", () => {
    const svg = buildT554InterfaceAtlas(inputs()).files.get("interface-matterpak-1-9-0-2.svg");
    if (svg === undefined) throw new Error("synthetic interface SVG is absent");
    const path = /<path d="M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+) Z"[^>]*data-source-side="room9"/u.exec(svg);
    if (path === null) throw new Error("synthetic room9 XY path is absent");
    const x0 = Number(path[1]);
    const y0 = Number(path[2]);
    const x1 = Number(path[3]);
    const y1 = Number(path[4]);
    const x2 = Number(path[5]);
    const y2 = Number(path[6]);
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(Math.hypot(x2 - x0, y2 - y0), 5);
  });

  it("parses the deliberately narrow CLI contract", () => {
    expect(parseGrandHallT554InterfaceAtlasArguments([
      "--check", "--source-root", "Q:\\matterpak", "--out", "Q:\\atlas",
    ])).toEqual({
      check: true,
      matterpakSourceRoot: "Q:\\matterpak",
      outputDirectory: "Q:\\atlas",
    });
    expect(GRAND_HALL_T554_INTERFACE_ATLAS_USAGE).toContain("authors no closure");
    expect(() => parseGrandHallT554InterfaceAtlasArguments(["--check"])).toThrow(/required/u);
    expect(() => parseGrandHallT554InterfaceAtlasArguments([
      "--source-root", "Q:\\a", "--source-root", "Q:\\b", "--out", "Q:\\o",
    ])).toThrow(/repeated/u);
    expect(() => parseGrandHallT554InterfaceAtlasArguments(["--unknown"])).toThrow(/unknown/u);
  });
});

describe("persisted T-554 interface atlas verification", () => {
  it("rejects a coherently resealed summary over the exact checked Grand Hall source", () => {
    const checkedAtlas = fileURLToPath(new URL(
      "../../../../docs/operations/grand-hall-t554-review-pack/boundary/interfaces/",
      import.meta.url,
    ));
    withTemporaryDirectory((directory) => {
      const copy = join(directory, "copy");
      cpSync(checkedAtlas, copy, { recursive: true });
      const manifest = record(
        JSON.parse(readFileSync(join(copy, "manifest.json"), "utf8")),
        "checked atlas manifest",
      );
      const topology = record(manifest.room9SourceTopology, "room9 topology");
      topology.faceCount = (topology.faceCount as number) + 1;
      overwriteManifest(copy, manifest);

      expect(() => verifyPersistedT554InterfaceAtlas(copy)).toThrow(/checked golden receipt/u);
    });
  });

  it("verifies deterministic regeneration and exact output inventory", () => {
    withTemporaryDirectory((directory) => {
      const pack = buildT554InterfaceAtlas(inputs());
      writePack(directory, pack);
      expect(verifyPersistedT554InterfaceAtlas(directory)).toBe(pack.manifestSha256);
      expect(checkT554InterfaceAtlasExactRegeneration(inputs(), directory)).toBe(pack.manifestSha256);

      writeFileSync(join(directory, "unexpected.svg"), "<svg></svg>\n", "utf8");
      expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/inventory drifted/u);
      unlinkSync(join(directory, "unexpected.svg"));

      const firstFile = [...pack.files.keys()][0];
      if (firstFile === undefined) throw new Error("synthetic atlas file inventory is empty");
      unlinkSync(join(directory, firstFile));
      expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/inventory drifted/u);
    });
  });

  it("rejects omitted and extra manifest interfaces even after root resealing", () => {
    for (const mutation of ["omit", "extra"] as const) {
      withTemporaryDirectory((directory) => {
        const pack = buildT554InterfaceAtlas(inputs());
        writePack(directory, pack);
        const manifest = cloneManifest(pack);
        const interfaces = array(manifest.interfaces, "interfaces");
        if (mutation === "omit") interfaces.pop();
        else interfaces.push(JSON.parse(JSON.stringify(interfaces[0])));
        overwriteManifest(directory, manifest);
        expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/omitted or added/u);
      });
    }
  });

  it("rejects wrong group, vertex index, position, face ordinal, component, and digest evidence", () => {
    const mutations: readonly ((item: MutableRecord) => void)[] = [
      (item) => {
        record(item.roomB, "room B").subIndex = 99;
      },
      (item) => {
        const shared = record(item.sharedVertices, "shared vertices");
        record(array(shared.vertices, "vertices")[0], "first vertex").index = 999_999;
      },
      (item) => {
        const topology = record(item.localSourceTopology, "topology");
        const room9 = record(topology.room9, "room9");
        const firstVertex = record(array(room9.vertices, "room9 vertices")[0], "room9 vertex");
        const position = array(firstVertex.position, "position");
        position[0] = (position[0] as number) + 0.125;
      },
      (item) => {
        const topology = record(item.localSourceTopology, "topology");
        const room9 = record(topology.room9, "room9");
        record(array(room9.triangles, "triangles")[0], "triangle").sourceFaceOrdinal = 999;
      },
      (item) => {
        const induced = record(item.inducedSourceEdgeComponents, "induced");
        record(array(induced.components, "components")[0], "component").componentIndex = 2;
      },
      (item) => {
        item.evidenceSha256 = `sha256:${"f".repeat(64)}`;
      },
    ];
    for (const mutate of mutations) {
      withTemporaryDirectory((directory) => {
        const pack = buildT554InterfaceAtlas(inputs());
        writePack(directory, pack);
        const manifest = cloneManifest(pack);
        mutateFirstInterface(manifest, mutate);
        overwriteManifest(directory, manifest);
        expect(() => checkT554InterfaceAtlasExactRegeneration(inputs(), directory)).toThrow();
      });
    }
  });

  it("rejects a resealed persisted material path outside the builder grammar", () => {
    withTemporaryDirectory((directory) => {
      const pack = buildT554InterfaceAtlas(inputs());
      writePack(directory, pack);
      const manifest = cloneManifest(pack);
      mutateFirstInterface(manifest, (item) => {
        const topology = record(item.localSourceTopology, "topology");
        const room9 = record(topology.room9, "room9");
        record(array(room9.triangles, "triangles")[0], "triangle").material = "textures/secret.jpg";
      });
      overwriteManifest(directory, manifest);
      expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/source material name is unsafe/u);
    });
  });

  it("rejects a resealed persisted OBJ locator outside the builder namespace", () => {
    withTemporaryDirectory((directory) => {
      const pack = buildT554InterfaceAtlas(inputs());
      writePack(directory, pack);
      const manifest = cloneManifest(pack);
      const binding = record(manifest.sourceBinding, "source binding");
      record(binding.obj, "OBJ binding").sourceLocator = "OTHER/source.obj";
      overwriteManifest(directory, manifest);
      expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/canonical source namespace/u);
    });
  });

  it("rejects authority escalation and non-null disposition", () => {
    for (const mutate of [
      (manifest: MutableRecord) => {
        record(manifest.authority, "authority").runtimeAuthority = true;
      },
      (manifest: MutableRecord) => {
        mutateFirstInterface(manifest, (item) => {
          item.disposition = "include";
        });
      },
    ]) {
      withTemporaryDirectory((directory) => {
        const pack = buildT554InterfaceAtlas(inputs());
        writePack(directory, pack);
        const manifest = cloneManifest(pack);
        mutate(manifest);
        overwriteManifest(directory, manifest);
        expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/authority-none|pending\/null/u);
      });
    }
  });

  it("rejects active SVG content, operator paths, and manifest path escapes", () => {
    for (const unsafe of [
      "<script>alert(1)</script>",
      "<style>@import '/tracking.css';</style>",
      '<animate attributeName="opacity" from="0" to="1"/>',
      '<rect x="0" y="0" width="1" height="1" fill="u&#114;l&#40;/tracking.svg&#41;"/>',
      '<rect x="0" y="0" width="1" height="1" fill="u/**/rl(/tracking.svg)"/>',
      "<text>C:\\capture\\secret.obj</text>",
      '<image href="outside.png"/>',
    ]) {
      withTemporaryDirectory((directory) => {
        const pack = buildT554InterfaceAtlas(inputs());
        writePack(directory, pack);
        const firstFile = [...pack.files.keys()][0];
        if (firstFile === undefined) throw new Error("synthetic atlas file inventory is empty");
        const original = readFileSync(join(directory, firstFile), "utf8");
        const changed = original.replace("</svg>\n", `${unsafe}</svg>\n`);
        const bytes = new TextEncoder().encode(changed);
        writeFileSync(join(directory, firstFile), bytes);
        const manifest = cloneManifest(pack);
        updateOutputReceipt(manifest, firstFile, bytes);
        overwriteManifest(directory, manifest);
        expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/forbidden|operator path|external/u);
      });
    }

    withTemporaryDirectory((directory) => {
      const pack = buildT554InterfaceAtlas(inputs());
      writePack(directory, pack);
      const manifest = cloneManifest(pack);
      record(array(manifest.outputs, "outputs")[0], "first output").relativePath = "../escape.svg";
      overwriteManifest(directory, manifest);
      expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/path|order differs/u);
    });
  });

  it("rejects linked members and same-path byte-identical replacements", () => {
    withTemporaryDirectory((directory) => {
      const pack = buildT554InterfaceAtlas(inputs());
      writePack(directory, pack);
      const firstFile = [...pack.files.keys()][0];
      if (firstFile === undefined) throw new Error("synthetic atlas file inventory is empty");
      const memberPath = join(directory, firstFile);
      const externalPath = join(directory, "..", `${firstFile}.external-${String(process.pid)}`);
      copyFileSync(memberPath, externalPath);
      unlinkSync(memberPath);
      let memberSymlinkCreated = false;
      try {
        symlinkSync(externalPath, memberPath, "file");
        memberSymlinkCreated = true;
      } catch (error) {
        const code = record(error, "symlink error").code;
        if (code === "EPERM" || code === "EACCES") {
          expect(["EPERM", "EACCES"]).toContain(code);
          copyFileSync(externalPath, memberPath);
        } else {
          throw error;
        }
      }
      if (memberSymlinkCreated) {
        expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/cannot be a link/u);
        unlinkSync(memberPath);
        copyFileSync(externalPath, memberPath);
      }
      rmSync(externalPath, { force: true });

      const hardLinkPath = `${externalPath}.hard-link`;
      linkSync(memberPath, hardLinkPath);
      expect(() => verifyPersistedT554InterfaceAtlas(directory)).toThrow(/hard links/u);
      unlinkSync(hardLinkPath);

      let replaced = false;
      expect(() => verifyPersistedT554InterfaceAtlas(directory, {
        afterDescriptorRead: (event) => {
          if (replaced || event.purpose !== "svg") return;
          replaced = true;
          const backup = `${event.canonicalPath}.opened`;
          renameSync(event.canonicalPath, backup);
          copyFileSync(backup, event.canonicalPath);
        },
      })).toThrow(/path identity changed/u);
    });
  });
});

describe("descriptor-bound atlas evidence reader", () => {
  it("rejects OBJ tamper, links, and a byte-identical same-path replacement", () => {
    withTemporaryDirectory((directory) => {
      const sourcePath = join(directory, "source.obj");
      const original = new TextEncoder().encode("v 0 0 0\n");
      writeFileSync(sourcePath, original);
      const expectation = {
        byteLength: original.byteLength,
        sha256: digest(original),
        maximumByteLength: original.byteLength,
      };
      expect(readStableT554InterfaceAtlasFile(
        sourcePath,
        expectation,
        { purpose: "source_obj", fileName: "source.obj" },
      ).sha256).toBe(expectation.sha256);

      writeFileSync(sourcePath, "v 9 9 9\n", "utf8");
      expect(() => readStableT554InterfaceAtlasFile(
        sourcePath,
        expectation,
        { purpose: "source_obj", fileName: "source.obj" },
      )).toThrow(/SHA-256 differs/u);
      writeFileSync(sourcePath, original);

      const hardLinkPath = join(directory, "source-hard-link.obj");
      linkSync(sourcePath, hardLinkPath);
      expect(() => readStableT554InterfaceAtlasFile(
        sourcePath,
        expectation,
        { purpose: "source_obj", fileName: "source.obj" },
      )).toThrow(/hard links/u);
      unlinkSync(hardLinkPath);

      const targetPath = join(directory, "target.obj");
      copyFileSync(sourcePath, targetPath);
      unlinkSync(sourcePath);
      let sourceSymlinkCreated = false;
      try {
        symlinkSync(targetPath, sourcePath, "file");
        sourceSymlinkCreated = true;
      } catch (error) {
        const code = record(error, "symlink error").code;
        if (code === "EPERM" || code === "EACCES") {
          expect(["EPERM", "EACCES"]).toContain(code);
          copyFileSync(targetPath, sourcePath);
        } else {
          throw error;
        }
      }
      if (sourceSymlinkCreated) {
        expect(() => readStableT554InterfaceAtlasFile(
          sourcePath,
          expectation,
          { purpose: "source_obj", fileName: "source.obj" },
        )).toThrow(/cannot be a link/u);
      }
      rmSync(sourcePath, { force: true });
      copyFileSync(targetPath, sourcePath);

      let replaced = false;
      expect(() => readStableT554InterfaceAtlasFile(
        sourcePath,
        expectation,
        { purpose: "source_obj", fileName: "source.obj" },
        {
          afterDescriptorRead: (event) => {
            if (replaced) return;
            replaced = true;
            const backup = `${event.canonicalPath}.opened`;
            renameSync(event.canonicalPath, backup);
            copyFileSync(backup, event.canonicalPath);
          },
        },
      )).toThrow(/path identity changed/u);
    });
  });

  it("rejects an output below an already-existing directory reached through a linked ancestor", () => {
    withTemporaryDirectory((directory) => {
      const sourceRoot = join(directory, "source-root");
      const targetRoot = join(directory, "linked-target");
      const existingParent = join(targetRoot, "existing-parent");
      const linkedAncestor = join(directory, "linked-ancestor");
      mkdirSync(sourceRoot);
      mkdirSync(existingParent, { recursive: true });
      try {
        symlinkSync(targetRoot, linkedAncestor, "junction");
      } catch (error) {
        const code = record(error, "symlink error").code;
        if (code === "EPERM" || code === "EACCES") return;
        throw error;
      }
      expect(() => writeT554InterfaceAtlas({
        matterpakSourceRoot: sourceRoot,
        outputDirectory: join(linkedAncestor, "existing-parent", "new-atlas"),
      })).toThrow(/traverses a link/u);
    });
  });
});

describe("checked-in T-554 interface topology atlas", () => {
  it("is exact-inventory, self-verifying, source-bound, and authority-none", () => {
    const artifactUrl = new URL(
      "../../../../docs/operations/grand-hall-t554-review-pack/boundary/interfaces/",
      import.meta.url,
    );
    const directory = fileURLToPath(artifactUrl);
    const digestValue = verifyPersistedT554InterfaceAtlas(directory);
    expect(digestValue).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const manifest = record(JSON.parse(readFileSync(new URL("manifest.json", artifactUrl), "utf8")), "manifest");
    expect(record(record(manifest.sourceBinding, "source binding").obj, "OBJ binding")).toMatchObject({
      byteLength: 38_381_816,
      sha256: "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
    });
    expect(record(manifest.room9SourceTopology, "room9 topology")).toMatchObject({
      faceCount: 119_564,
      boundaryEdgeCount: 1_702,
      watertightClaim: false,
    });
    expect(record(manifest.authority, "authority")).toMatchObject({
      state: "none",
      reviewState: "human_pending",
      closurePlaneAuthored: false,
      runtimeAuthority: false,
    });
    expect(JSON.stringify(manifest)).not.toMatch(/[A-Za-z]:[\\/]/u);
  });
});
