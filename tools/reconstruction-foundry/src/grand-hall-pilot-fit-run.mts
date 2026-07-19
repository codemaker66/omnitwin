import { openSync, readSync, closeSync, readFileSync, writeFileSync } from "node:fs";

import { FoundryTransformEdgeSchema } from "@omnitwin/types";

import {
  cameraCentreFromPose,
  extractE57ScanTranslations,
  parseColmapImagesBin,
  readE57LogicalBytes,
} from "./grand-hall-pilot-inspection.js";
import { buildPilotFitReport, type PilotCorrespondence } from "./grand-hall-pilot-fit.js";

const CREATED_AT = "2026-07-19T10:21:36.000Z";
const E57_PATH = "F:/E57/cloud_0.e57";
const IMAGES_BIN = "F:/E57/colmap_v2/sparse/0/images.bin";
const OUT_REPORT = "C:/Users/blake/omnitwin2/docs/operations/grand-hall-pilot-fit-residual-report-2026-07-19.json";
const OUT_TRANSFORM = "C:/Users/blake/omnitwin2/docs/operations/grand-hall-pilot-proposed-transform-2026-07-19.json";

// E57 header: signature[8], major u32, minor u32, filePhysicalLength u64,
// xmlPhysicalOffset u64, xmlPhysicalLength u64, pageSize u64.
const fd = openSync(E57_PATH, "r");
const header = Buffer.alloc(48);
readSync(fd, header, 0, 48, 0);
if (header.toString("ascii", 0, 8) !== "ASTM-E57") {
  throw new Error("not an ASTM E57 file");
}
const xmlPhysicalOffset = Number(header.readBigUInt64LE(24));
const xmlLogicalLength = Number(header.readBigUInt64LE(32));
// Read a PAGE-ALIGNED physical chunk so the walker's page phase (index mod
// 1024) equals the file's true phase; the XML then begins at offsetInPage.
const pageStart = Math.floor(xmlPhysicalOffset / 1024) * 1024;
const offsetInPage = xmlPhysicalOffset - pageStart;
const physicalSpan = Math.ceil((offsetInPage + xmlLogicalLength) / 1020) * 1024 + 2048;
const physicalChunk = Buffer.alloc(physicalSpan);
readSync(fd, physicalChunk, 0, physicalSpan, pageStart);
closeSync(fd);
const xmlBytes = readE57LogicalBytes(
  new Uint8Array(physicalChunk.buffer, physicalChunk.byteOffset, physicalChunk.byteLength),
  offsetInPage,
  xmlLogicalLength,
);
const xml = new TextDecoder().decode(xmlBytes);
const translations = extractE57ScanTranslations(xml);

const images = parseColmapImagesBin(new Uint8Array(readFileSync(IMAGES_BIN)));
const centresBySweep = new Map<number, [number, number, number][]>();
for (const image of images) {
  const match = /^scan_(\d{3})_[a-z]+\.jpg$/u.exec(image.name);
  if (match === null) continue;
  const sweep = Number(match[1]);
  const centre = cameraCentreFromPose(image.qvec, image.tvec);
  const list = centresBySweep.get(sweep) ?? [];
  list.push(centre);
  centresBySweep.set(sweep, list);
}
const correspondences: PilotCorrespondence[] = [];
for (const [sweep, centres] of [...centresBySweep.entries()].sort((a, b) => a[0] - b[0])) {
  const target = translations[sweep];
  if (target === undefined || sweep > 49) continue;
  const mean: [number, number, number] = [
    centres.reduce((s, c) => s + c[0], 0) / centres.length,
    centres.reduce((s, c) => s + c[1], 0) / centres.length,
    centres.reduce((s, c) => s + c[2], 0) / centres.length,
  ];
  correspondences.push({ sweepIndex: sweep, source: mean, target: [target.x, target.y, target.z] });
}

const report = buildPilotFitReport(correspondences);
const evidence = {
  schemaVersion: "omnitwin.foundry.pilot-fit-residual-report.v0",
  createdAt: CREATED_AT,
  ingestManifestSha256:
    "sha256:63516c0b1c9583086108879659b771809c5bea4272c175c9dbb809a6c66bfd89",
  inputs: {
    e57: "e57-main",
    colmapImagesBin: "colmap-sparse-images-bin",
    registeredImages: images.length,
    e57ScanTranslations: translations.length,
    sweepCorrespondences: correspondences.length,
  },
  disposition:
    "PROPOSED DIAGNOSTIC ONLY - diagnostic of the derived COLMAP image set against E57 pose translations; not a reviewed TransformArtifact, no runtime or public authority, and per the T-507 audit NOT the governing transform of the E57-native 149-node release.",
  ...report,
};
writeFileSync(OUT_REPORT, `${JSON.stringify(evidence, null, 2)}\n`);

// Column-major [sR | t] with similarity validation via the shared schema.
const sR = report.rotationRows.map((row) => row.map((value) => value * report.scale));
const matrix = [
  sR[0]?.[0] ?? 0, sR[1]?.[0] ?? 0, sR[2]?.[0] ?? 0, 0,
  sR[0]?.[1] ?? 0, sR[1]?.[1] ?? 0, sR[2]?.[1] ?? 0, 0,
  sR[0]?.[2] ?? 0, sR[1]?.[2] ?? 0, sR[2]?.[2] ?? 0, 0,
  report.translation[0], report.translation[1], report.translation[2], 1,
];
const transformEdge = FoundryTransformEdgeSchema.parse({
  id: "colmap-sfm-to-venue-control-proposed",
  sourceFrameId: "colmap-sfm",
  targetFrameId: "venue-control",
  operationKind: "affine_similarity",
  matrix,
  state: "proposed",
  transformArtifactAssetId: null,
  residualReportAssetId: null,
  projectionArtifactAssetId: null,
  reviewerAttestationAssetId: null,
  provenanceAssetIds: ["e57-main", "colmap-sparse-images-bin"],
});
writeFileSync(OUT_TRANSFORM, `${JSON.stringify(transformEdge, null, 2)}\n`);

process.stdout.write(
  [
    `correspondences=${String(correspondences.length)} scale=${report.scale.toFixed(10)}`,
    `fit: median=${(report.fitSet.residuals.medianMeters * 1000).toFixed(2)}mm rmse=${(report.fitSet.residuals.rmseMeters * 1000).toFixed(2)}mm p95=${(report.fitSet.residuals.p95Meters * 1000).toFixed(2)}mm max=${(report.fitSet.residuals.maxMeters * 1000).toFixed(2)}mm`,
    `heldout: median=${(report.heldOutSet.residuals.medianMeters * 1000).toFixed(2)}mm rmse=${(report.heldOutSet.residuals.rmseMeters * 1000).toFixed(2)}mm p95=${(report.heldOutSet.residuals.p95Meters * 1000).toFixed(2)}mm max=${(report.heldOutSet.residuals.maxMeters * 1000).toFixed(2)}mm`,
    `overlap=${report.overlapFraction.toFixed(2)}`,
  ].join("\n") + "\n",
);
