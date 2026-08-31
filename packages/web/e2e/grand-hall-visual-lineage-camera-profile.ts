import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { VisualLineageActualCameraV0 } from "@omnitwin/types";

import {
  GRAND_HALL_LINEAGE_CAMERA,
  GRAND_HALL_LINEAGE_TARGET,
  grandHallLineageCameraMatches,
} from "../src/lib/grand-hall-visual-lineage.js";

export const GRAND_HALL_SHARED_CAMERA_PROFILE_RELATIVE_PATH =
  "tools/reconstruction-foundry/native/grand-hall-lcc-native-capture/camera-profile.json";
export const GRAND_HALL_SHARED_CAMERA_PROFILE_EVIDENCE_PREFIX =
  "VENVIEWER_SHARED_CAMERA_PROFILE_V1:";

type Vec3 = readonly [number, number, number];

export interface GrandHallSharedCameraProfileBinding {
  readonly relativePath: string;
  readonly sha256: string;
  readonly profileId: string;
  readonly threePosition: Vec3;
  readonly threeTarget: Vec3;
  readonly verticalFieldOfViewDegrees: number;
  readonly nearClipMetres: number;
  readonly farClipMetres: number;
  readonly aspect: number;
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(
  record: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`Shared camera profile field ${key} must be an object.`);
  return value;
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Shared camera profile field ${key} must be a non-empty string.`);
  }
  return value;
}

function requiredNumber(record: Readonly<Record<string, unknown>>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Shared camera profile field ${key} must be a finite number.`);
  }
  return value;
}

function requiredVec3(record: Readonly<Record<string, unknown>>, key: string): Vec3 {
  const value = record[key];
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  ) {
    throw new Error(`Shared camera profile field ${key} must be a finite vec3.`);
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function parseGrandHallSharedCameraProfile(
  bytes: Buffer,
): GrandHallSharedCameraProfileBinding {
  const parsed: unknown = JSON.parse(bytes.toString("utf8"));
  if (!isRecord(parsed)) throw new Error("Shared camera profile root must be an object.");
  const frames = requiredRecord(parsed, "frames");
  const three = requiredRecord(frames, "three");
  const projection = requiredRecord(parsed, "projection");
  const output = requiredRecord(parsed, "output");
  const binding: GrandHallSharedCameraProfileBinding = {
    relativePath: GRAND_HALL_SHARED_CAMERA_PROFILE_RELATIVE_PATH,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    profileId: requiredString(parsed, "profileId"),
    threePosition: requiredVec3(three, "position"),
    threeTarget: requiredVec3(three, "target"),
    verticalFieldOfViewDegrees: requiredNumber(projection, "verticalFieldOfViewDegrees"),
    nearClipMetres: requiredNumber(projection, "nearClipMetres"),
    farClipMetres: requiredNumber(projection, "farClipMetres"),
    aspect: requiredNumber(projection, "aspect"),
    width: requiredNumber(output, "width"),
    height: requiredNumber(output, "height"),
    devicePixelRatio: requiredNumber(output, "devicePixelRatio"),
  };
  if (requiredString(parsed, "schemaVersion") !== "venviewer.grand-hall.fixed-camera-profile.v1") {
    throw new Error("Shared camera profile schema version is unsupported.");
  }
  if (requiredString(parsed, "authority") !== "none") {
    throw new Error("Shared camera profile must retain authority none.");
  }
  if (
    binding.profileId !== GRAND_HALL_LINEAGE_CAMERA.id
    || !arraysEqual(binding.threePosition, GRAND_HALL_LINEAGE_CAMERA.position)
    || !arraysEqual(binding.threeTarget, GRAND_HALL_LINEAGE_TARGET)
    || binding.verticalFieldOfViewDegrees !== GRAND_HALL_LINEAGE_CAMERA.fov
    || binding.nearClipMetres !== GRAND_HALL_LINEAGE_CAMERA.near
    || binding.farClipMetres !== GRAND_HALL_LINEAGE_CAMERA.far
    || binding.aspect !== GRAND_HALL_LINEAGE_CAMERA.aspect
    || binding.width !== 1_600
    || binding.height !== 900
    || binding.devicePixelRatio !== 1
  ) {
    throw new Error("Shared native/browser camera profile deviates from the fixed browser contract.");
  }
  return binding;
}

export async function readGrandHallSharedCameraProfile(
  repositoryRoot: string,
): Promise<GrandHallSharedCameraProfileBinding> {
  const bytes = await readFile(
    path.resolve(repositoryRoot, GRAND_HALL_SHARED_CAMERA_PROFILE_RELATIVE_PATH),
  );
  return parseGrandHallSharedCameraProfile(bytes);
}

export function grandHallSharedCameraProfileMatchesActual(
  binding: GrandHallSharedCameraProfileBinding,
  actual: VisualLineageActualCameraV0,
): boolean {
  return binding.profileId === GRAND_HALL_LINEAGE_CAMERA.id
    && arraysEqual(binding.threePosition, actual.position)
    && grandHallLineageCameraMatches(actual);
}

export function grandHallSharedCameraProfileEvidence(
  binding: GrandHallSharedCameraProfileBinding,
): string {
  return `${GRAND_HALL_SHARED_CAMERA_PROFILE_EVIDENCE_PREFIX}${JSON.stringify({
    profileId: binding.profileId,
    relativePath: binding.relativePath,
    sha256: binding.sha256,
  })}`;
}
