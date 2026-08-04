import type {
  CaptureFileClassification,
  CaptureFileSignature,
  CaptureInventoryFile,
} from "@omnitwin/types";

const GUID_ASSET = /^[a-f0-9]{32}(?:_\d{3})?\.(?:obj|mtl|jpg)$/i;
const EDITED_NAME = /(?:^|[_ .-])(?:aligned|edited|fixed|repair|repaired|converted|rc)(?:[_ .-]|$)/i;
const DERIVED_DIRECTORY = /^(?:brush_dataset|colmap(?:_|$)|cubemaps?(?:_|$)|equirect(?:_|$)|panoramas|__pycache__)/i;
const VENDOR_CONTAINER = /(?:matterpak|(?:^| )obj(?: |$))/i;
const VENDOR_SIDECAR = /^(?:cloud\.xyz|rsmeta\.db|readme\.pdf|(?:ceiling)?colorplan(?:_\d{3})?\.(?:jpg|pdf))$/i;

function result(
  role: CaptureFileClassification["role"],
  disposition: CaptureFileClassification["disposition"],
  confidence: CaptureFileClassification["confidence"],
  evidence: CaptureFileClassification["evidence"],
): CaptureFileClassification {
  return { role, disposition, confidence, evidence };
}

function isVendorControl(relativePath: string): boolean {
  const parts = relativePath.split("/");
  const container = parts[0];
  const name = parts.at(-1);
  if (parts.length < 2 || container === undefined || name === undefined) return false;
  if (!VENDOR_CONTAINER.test(container)) return false;
  return GUID_ASSET.test(name) || VENDOR_SIDECAR.test(name);
}

export function classifyCaptureFile(
  relativePath: string,
  signature: CaptureFileSignature,
): CaptureFileClassification {
  const parts = relativePath.split("/");
  const top = parts[0];
  const name = parts.at(-1);
  if (top === undefined || name === undefined) {
    throw new Error(`Capture path must not be empty: ${relativePath}`);
  }
  const lowerName = name.toLowerCase();

  if (signature.format === "e57") {
    return result("primary_capture", "stage", "high", ["astm_e57_signature"]);
  }
  if (EDITED_NAME.test(name)) {
    return result("experiment", "exclude", "high", ["aligned_or_edited_name"]);
  }
  if (isVendorControl(relativePath)) {
    const evidence = GUID_ASSET.test(name)
      ? (["matterpak_guid_asset_name", "known_vendor_control_format"] as const)
      : (["matterpak_vendor_sidecar", "known_vendor_control_format"] as const);
    return result("vendor_control", "stage", "high", [...evidence]);
  }
  if (lowerName === "poses.json") {
    return result("derived_reference", "reference_only", "high", ["derived_pose_sidecar"]);
  }
  if (top.toLowerCase() === "equirect_fixed") {
    return result("derived_reference", "reference_only", "medium", ["explicit_derived_directory"]);
  }
  if (DERIVED_DIRECTORY.test(top)) {
    const evidence = signature.format === "ply"
      ? (["explicit_derived_directory", "generated_checkpoint"] as const)
      : (["explicit_derived_directory", "pipeline_output_name"] as const);
    return result("experiment", "exclude", "high", [...evidence]);
  }
  if (signature.format === "python" || lowerName.endsWith(".pyc")) {
    return result("diagnostic", "exclude", "high", ["executable_script"]);
  }
  if (name.startsWith("_") || lowerName === "test.txt") {
    return result("diagnostic", "exclude", "high", ["diagnostic_name"]);
  }
  if (signature.format === "nwc" || (parts.length === 1 && signature.format === "png")) {
    return result("derived_reference", "reference_only", "medium", ["reference_design_file"]);
  }
  if (signature.format === "ply") {
    return result("experiment", "exclude", "high", ["generated_checkpoint"]);
  }
  return result("unknown", "exclude", "low", ["unknown_provenance"]);
}

export function targetRelativePathFor(file: CaptureInventoryFile): string {
  if (file.classification.role === "primary_capture") {
    return `source/e57/${file.relativePath}`;
  }
  if (file.classification.role !== "vendor_control") {
    throw new Error(`Cannot create a copy target for ${file.classification.role}`);
  }
  const parts = file.relativePath.split("/");
  const vendorRelativePath = parts.length > 1 ? parts.slice(1).join("/") : file.relativePath;
  return `source/matterpak/${vendorRelativePath}`;
}
