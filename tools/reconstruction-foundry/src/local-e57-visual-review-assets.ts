export const LOCAL_E57_VISUAL_REVIEW_JAVASCRIPT = String.raw`(() => {
  "use strict";

  const artifactSchema = "omnitwin.foundry.e57-geometry-crop.v0";
  const readerSchema = "omnitwin.foundry.e57-geometry-reader-description.v0";
  const visualDraftSchema = "omnitwin.local-foundry.e57-visual-inspection-draft.v0";
  const maskRequestSchema = "omnitwin.local-foundry.e57-point-classification-mask-request.v0";
  const maskSchema = "omnitwin.foundry.e57-point-classification-mask.v0";
  const artifactDigestDomain = "VENVIEWER_FOUNDRY_E57_GEOMETRY_CROP_V0";
  const readerDigestDomain = "VENVIEWER_FOUNDRY_E57_GEOMETRY_READER_DESCRIPTION_V0";
  const viewDigestDomain = "VENVIEWER_LOCAL_E57_VISUAL_INSPECTION_VIEW_V0";
  const draftDigestDomain = "VENVIEWER_LOCAL_E57_VISUAL_INSPECTION_DRAFT_V0";
  const maskDigestDomain = "VENVIEWER_FOUNDRY_E57_POINT_CLASSIFICATION_MASK_V0";
  const maskRoute = "/api/room-reality-review/e57-classification-mask";
  const maximumFileBytes = 12 * 1024 * 1024;
  const maximumMaskRequestBytes = 16 * 1024 * 1024;
  const maximumMaskResponseBytes = 64 * 1024 * 1024;
  const maximumPoints = 50000;
  const maximumMaskRules = 256;
  const maximumCoordinate = 1000000000;
  const maximumAnnotations = 100;
  const minimumEffectiveComparisonOpacity = 0.05;
  const digestPattern = /^sha256:[a-f0-9]{64}$/u;
  const safeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
  const safeVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,159}$/u;
  const maskRuleIdPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/u;
  const localSessionTokenPattern = /^[A-Za-z0-9_-]{43,128}$/u;
  const localSessionKey = "omnitwin.foundry.local-session-token";
  const suppliedLocalSessionToken = new URLSearchParams(window.location.search).get("token");
  const localSessionToken = suppliedLocalSessionToken || window.sessionStorage.getItem(localSessionKey);
  const dimensions = [
    ["source_comparison", "Source comparison"],
    ["alignment", "Alignment"],
    ["scale", "Metric scale"],
    ["crop", "Crop and review bounds"],
    ["completeness", "Architectural completeness"],
    ["privacy", "Privacy"],
    ["movable_objects", "Movable objects"]
  ];
  const expectedLimitations = [
    "This V0 worker emits a bounded authority-none JSON point crop, not a mesh, collision surface, placement surface, measurement authority, export authority, or production runtime member.",
    "The worker accepts only Cartesian E57 data3D points with explicit scan poses; spherical-only scans and pose-free scans fail closed.",
    "This V0 contract is capped at a 256 MiB container, 1,000,000 total points, 64 scans, 79 fixed-size reader batches, and 9,000,000 scan-prefix point visits per run. The accepted pye57/libE57Format 0.4.19 binding exposes seek but returned ErrorNotImplemented on the tiny fixture. The legacy command adapter replays a scan prefix per batch; the persistent adapter avoids that replay only within one uninterrupted run, while every resumed run still replays its complete checkpoint prefix. Neither adapter proves a Grand Hall-scale path.",
    "The E57 root frame is reported in metres with right-handed Z-up axes according to the declared V0 adapter contract; no external CRS, CVF alignment, registration accuracy, or survey accuracy is established.",
    "Captured movable furniture and people are not detected or removed by this worker; all retained points remain unclassified captured content and are expressly excluded from placement, measurement, collision, and export authority.",
    "The source-facts digest is an exact invocation binding only; this worker does not authenticate or re-derive source facts or enforce the existing capture-stage guard, parent reparse checks, private output custody, JobSpec, or execution fence.",
    "When selected, pye57 and the Python launch accept filesystem paths rather than retained file handles. Full-file source hashes before and after reading plus pre-run bridge/interpreter hashes detect ordinary drift but do not close an adversarial swap-and-restore race, so production activation requires executor-held custody and sandboxing.",
    "Checkpoint and artifact digests prove deterministic local self-consistency only. Every supplied resume checkpoint is reconstructed by replaying its bounded source prefix and must equal that reconstruction before use; neither digest authenticates an operator, execution fence, worker image, rights decision, review, signing, activation, publication, or release eligibility.",
    "When selected, the included local pye57 bridge hashes every container byte, including bytes that may belong to embedded image blobs. The legacy adapter hashes before and after each command; the persistent adapter hashes before opening and after closing one uninterrupted stream session. Neither mode invokes an image decoder or extracts images, opens network sockets, or runs inference or training; caller-supplied filesystem roots must still be local and trusted.",
    "The path-based local adapter assumes trusted local source, bridge, and interpreter roots. Its caller-supplied identities, pre/post path hashes, safe-path Python flags, and sanitized environment do not close swap-and-restore races or authenticate the Python/native dependency environment, so its result cannot serve as production activation evidence.",
    "Production closure requires executor-held canonical private staging with no reparse or remote ancestors, an authenticated interpreter and dependency allowlist, an execution permit/fence, and sandboxed resource enforcement; this authority-none V0 seam supplies none of those controls."
  ];
  const inspectionBoundary = {
    input: "generated_bounded_e57_crop_json_only",
    artifactFileTransfer: "not_performed",
    rawE57Read: "not_performed",
    sourceImageRead: "not_performed",
    renderer: "bounded_local_canvas_projection",
    geometryAuthority: "none",
    placementAuthority: "excluded",
    measurementAuthority: "excluded",
    collisionAuthority: "excluded",
    exportAuthority: "excluded"
  };
  const draftCapabilities = {
    execution: "not_authorized",
    correctionApplication: "not_authorized",
    transformArtifactCreation: "not_authorized",
    sceneAuthorityCreation: "not_authorized",
    qaApproval: "not_authorized",
    packageExport: "not_authorized",
    runtimeActivation: "not_authorized"
  };

  function byId(id) {
    const node = document.getElementById(id);
    if (!node) throw new Error("The local visual review page is missing " + id + ".");
    return node;
  }

  function fail(message) {
    throw new Error(message);
  }

  function record(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(label + " must be one JSON object.");
    }
    return value;
  }

  function exactObject(value, keys, label) {
    const item = record(value, label);
    const expected = [...keys].sort();
    const actual = Object.keys(item).sort();
    if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
      fail(label + " has an invalid field set.");
    }
    return item;
  }

  function canonical(value) {
    if (value === null) return "null";
    if (typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail("Canonical JSON cannot contain non-finite numbers.");
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    const item = record(value, "Canonical JSON");
    return "{" + Object.keys(item)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => JSON.stringify(key) + ":" + canonical(item[key]))
      .join(",") + "}";
  }

  function sameCanonical(left, right) {
    return canonical(left) === canonical(right);
  }

  function without(value, omittedKey) {
    const output = {};
    for (const [key, member] of Object.entries(value)) {
      if (key !== omittedKey) output[key] = member;
    }
    return output;
  }

  async function sha256(domain, value, separator) {
    if (!globalThis.crypto || !globalThis.crypto.subtle) {
      fail("This browser cannot verify SHA-256 locally. No artifact was opened.");
    }
    const bytes = new TextEncoder().encode(domain + separator + canonical(value));
    const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const hex = Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return "sha256:" + hex;
  }

  function requireLiteral(value, expected, label) {
    if (value !== expected) fail(label + " must be " + String(expected) + ".");
    return expected;
  }

  function requireEnum(value, allowed, label) {
    if (typeof value !== "string" || !allowed.includes(value)) {
      fail(label + " is not an allowed contract value.");
    }
    return value;
  }

  function requireString(value, label, minimum, maximum) {
    if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
      fail(label + " must contain " + minimum + " to " + maximum + " characters.");
    }
    return value;
  }

  function requireDigest(value, label) {
    if (typeof value !== "string" || !digestPattern.test(value)) fail(label + " is not a SHA-256 fingerprint.");
    return value;
  }

  function requireNumber(value, label, minimum, maximum) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
      fail(label + " is outside the bounded finite range.");
    }
    return Object.is(value, -0) ? 0 : value;
  }

  function requireInteger(value, label, minimum, maximum) {
    const parsed = requireNumber(value, label, minimum, maximum);
    if (!Number.isSafeInteger(parsed)) fail(label + " must be a safe integer.");
    return parsed;
  }

  function vector3(value, label) {
    if (!Array.isArray(value) || value.length !== 3) fail(label + " must contain exactly three coordinates.");
    return value.map((member, index) => requireNumber(member, label + "[" + index + "]", -maximumCoordinate, maximumCoordinate));
  }

  function quaternion(value, label) {
    if (!Array.isArray(value) || value.length !== 4) fail(label + " must contain exactly four values.");
    const parsed = value.map((member, index) => requireNumber(member, label + "[" + index + "]", -1.000001, 1.000001));
    const norm = Math.hypot(...parsed);
    if (Math.abs(norm - 1) > 0.000001) fail(label + " must be normalized within 1e-6.");
    return parsed;
  }

  function bounds(value, label) {
    const item = exactObject(value, ["minimum", "maximum"], label);
    const minimum = vector3(item.minimum, label + ".minimum");
    const maximum = vector3(item.maximum, label + ".maximum");
    if (minimum.some((member, index) => member > maximum[index])) fail(label + " minimum exceeds maximum.");
    return { minimum, maximum };
  }

  function source(value, label) {
    const item = exactObject(value, ["assetId", "relativePath", "inputType", "sizeBytes", "sha256"], label);
    if (typeof item.assetId !== "string" || !safeIdPattern.test(item.assetId)) fail(label + ".assetId is invalid.");
    requireString(item.relativePath, label + ".relativePath", 1, 4096);
    requireEnum(item.inputType, ["generic_e57", "matterport_e57"], label + ".inputType");
    requireInteger(item.sizeBytes, label + ".sizeBytes", 1, 256 * 1024 * 1024);
    requireDigest(item.sha256, label + ".sha256");
    return item;
  }

  function coordinateContract(value, label) {
    const item = exactObject(value, ["inputPointFrame", "scanPoseConvention", "outputFrame", "units", "axes"], label);
    requireLiteral(item.inputPointFrame, "e57_data3d_local_cartesian", label + ".inputPointFrame");
    requireLiteral(item.scanPoseConvention, "normalized_quaternion_wxyz_then_translation_metres", label + ".scanPoseConvention");
    requireLiteral(item.outputFrame, "e57_root", label + ".outputFrame");
    requireLiteral(item.units, "metre", label + ".units");
    requireLiteral(item.axes, "right_handed_z_up", label + ".axes");
    return item;
  }

  function readerCoordinateContract(value, label) {
    const item = exactObject(value, ["pointFrame", "poseConvention", "rootFrame", "units", "axes"], label);
    requireLiteral(item.pointFrame, "e57_data3d_local_cartesian", label + ".pointFrame");
    requireLiteral(item.poseConvention, "normalized_quaternion_wxyz_then_translation_metres", label + ".poseConvention");
    requireLiteral(item.rootFrame, "e57_root", label + ".rootFrame");
    requireLiteral(item.units, "metre", label + ".units");
    requireLiteral(item.axes, "right_handed_z_up", label + ".axes");
    return item;
  }

  function crop(value, label) {
    const item = exactObject(value, ["frame", "units", "minimum", "maximum", "boundary"], label);
    requireLiteral(item.frame, "e57_root", label + ".frame");
    requireLiteral(item.units, "metre", label + ".units");
    requireLiteral(item.boundary, "inclusive", label + ".boundary");
    const parsed = { minimum: vector3(item.minimum, label + ".minimum"), maximum: vector3(item.maximum, label + ".maximum") };
    if (parsed.minimum.some((member, index) => member > parsed.maximum[index])) fail(label + " minimum exceeds maximum.");
    return item;
  }

  function readerAdapter(value, label) {
    const item = exactObject(value, ["name", "version", "bridgeArtifactSha256", "pythonVersion", "numpyVersion", "identityAuthority"], label);
    if (typeof item.name !== "string" || !safeIdPattern.test(item.name)) fail(label + ".name is invalid.");
    if (typeof item.version !== "string" || !safeVersionPattern.test(item.version)) fail(label + ".version is invalid.");
    requireDigest(item.bridgeArtifactSha256, label + ".bridgeArtifactSha256");
    for (const key of ["pythonVersion", "numpyVersion"]) {
      if (item[key] !== null) requireString(item[key], label + "." + key, 1, 160);
    }
    requireLiteral(item.identityAuthority, "caller_supplied_unverified", label + ".identityAuthority");
  }

  function readerPolicy(value, label) {
    const item = exactObject(value, ["sourceAccess", "batchAccess", "pointPayload", "fullContainerBytesHashed", "imageDecoderAccess", "imageExtraction", "network", "modelInference", "modelTraining"], label);
    const sourceAccess = requireEnum(item.sourceAccess, ["dependency_injected_caller_asserted_identity", "read_only_pre_and_post_size_sha256"], label + ".sourceAccess");
    requireEnum(item.batchAccess, ["dependency_injected", "scan_start_replay_bounded_buffer"], label + ".batchAccess");
    requireLiteral(item.pointPayload, "cartesian_fields_only", label + ".pointPayload");
    requireLiteral(item.imageDecoderAccess, false, label + ".imageDecoderAccess");
    requireLiteral(item.imageExtraction, false, label + ".imageExtraction");
    requireLiteral(item.network, "none", label + ".network");
    requireLiteral(item.modelInference, "none", label + ".modelInference");
    requireLiteral(item.modelTraining, "none", label + ".modelTraining");
    requireLiteral(item.fullContainerBytesHashed, sourceAccess === "read_only_pre_and_post_size_sha256", label + ".fullContainerBytesHashed");
  }

  function scan(value, index, label) {
    const item = exactObject(value, ["scanIndex", "data3dGuid", "pointCount", "pointFields", "pose"], label);
    requireLiteral(item.scanIndex, index, label + ".scanIndex");
    requireString(item.data3dGuid, label + ".data3dGuid", 1, 512);
    requireInteger(item.pointCount, label + ".pointCount", 1, 1000000);
    if (!Array.isArray(item.pointFields) || item.pointFields.length < 3 || item.pointFields.length > 256) fail(label + ".pointFields is invalid.");
    const fields = item.pointFields.map((field, fieldIndex) => requireString(field, label + ".pointFields[" + fieldIndex + "]", 1, 256));
    const sorted = [...fields].sort();
    if (new Set(fields).size !== fields.length || fields.some((field, fieldIndex) => field !== sorted[fieldIndex])) fail(label + ".pointFields must be unique and sorted.");
    for (const required of ["cartesianX", "cartesianY", "cartesianZ"]) {
      if (!fields.includes(required)) fail(label + ".pointFields is missing " + required + ".");
    }
    const pose = exactObject(item.pose, ["rotationWxyz", "translationM"], label + ".pose");
    quaternion(pose.rotationWxyz, label + ".pose.rotationWxyz");
    vector3(pose.translationM, label + ".pose.translationM");
    return item;
  }

  async function readerDescription(value, exactSource) {
    const label = "readerDescription";
    const item = exactObject(value, ["schemaVersion", "source", "adapter", "readPolicy", "coordinateContract", "scans", "totalPointCount", "authority", "descriptionSha256"], label);
    requireLiteral(item.schemaVersion, readerSchema, label + ".schemaVersion");
    const describedSource = source(item.source, label + ".source");
    if (!sameCanonical(describedSource, exactSource)) fail("The artifact and reader description do not bind the same exact source.");
    readerAdapter(item.adapter, label + ".adapter");
    readerPolicy(item.readPolicy, label + ".readPolicy");
    readerCoordinateContract(item.coordinateContract, label + ".coordinateContract");
    if (!Array.isArray(item.scans) || item.scans.length < 1 || item.scans.length > 64) fail(label + ".scans is outside the bounded contract.");
    const scans = item.scans.map((entry, index) => scan(entry, index, label + ".scans[" + index + "]"));
    if (new Set(scans.map((entry) => entry.data3dGuid)).size !== scans.length) fail(label + ".scans contains duplicate data3D GUIDs.");
    const total = scans.reduce((sum, entry) => sum + entry.pointCount, 0);
    requireLiteral(item.totalPointCount, total, label + ".totalPointCount");
    requireInteger(item.totalPointCount, label + ".totalPointCount", 1, 1000000);
    requireLiteral(item.authority, "none", label + ".authority");
    requireDigest(item.descriptionSha256, label + ".descriptionSha256");
    const expected = await sha256(readerDigestDomain, without(item, "descriptionSha256"), "\0");
    requireLiteral(item.descriptionSha256, expected, label + ".descriptionSha256");
    return item;
  }

  function outputPoint(value, index, scans, scanStarts, exactCrop) {
    const label = "points[" + index + "]";
    const item = exactObject(value, ["scanIndex", "data3dGuid", "sourcePointIndex", "xM", "yM", "zM"], label);
    const scanIndex = requireInteger(item.scanIndex, label + ".scanIndex", 0, scans.length - 1);
    const exactScan = scans[scanIndex];
    requireLiteral(item.data3dGuid, exactScan.data3dGuid, label + ".data3dGuid");
    requireInteger(item.sourcePointIndex, label + ".sourcePointIndex", 0, exactScan.pointCount - 1);
    const coordinates = [
      requireNumber(item.xM, label + ".xM", -maximumCoordinate, maximumCoordinate),
      requireNumber(item.yM, label + ".yM", -maximumCoordinate, maximumCoordinate),
      requireNumber(item.zM, label + ".zM", -maximumCoordinate, maximumCoordinate)
    ];
    if (coordinates.some((member, component) => member < exactCrop.minimum[component] || member > exactCrop.maximum[component])) {
      fail(label + " lies outside the declared inclusive crop.");
    }
    return { item, ordinal: scanStarts[scanIndex] + item.sourcePointIndex, coordinates };
  }

  function computedBounds(points) {
    if (points.length === 0) return null;
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    for (const point of points) {
      for (let component = 0; component < 3; component += 1) {
        minimum[component] = Math.min(minimum[component], point[component]);
        maximum[component] = Math.max(maximum[component], point[component]);
      }
    }
    return { minimum, maximum };
  }

  function movableContent(value) {
    const label = "movableContent";
    const item = exactObject(value, ["classification", "retainedContent", "geometryAuthority", "placementAuthority", "measurementAuthority", "collisionAuthority", "exportAuthority"], label);
    requireLiteral(item.classification, "not_performed", label + ".classification");
    requireLiteral(item.retainedContent, "may_include_captured_movable_objects", label + ".retainedContent");
    requireLiteral(item.geometryAuthority, "none", label + ".geometryAuthority");
    for (const key of ["placementAuthority", "measurementAuthority", "collisionAuthority", "exportAuthority"]) requireLiteral(item[key], "excluded", label + "." + key);
  }

  function artifactCapabilities(value) {
    const label = "capabilities";
    const keys = ["runtimeRegistration", "immutableRegistration", "signing", "activation", "publication", "promotion"];
    const item = exactObject(value, keys, label);
    for (const key of keys) requireLiteral(item[key], "not_authorized", label + "." + key);
  }

  async function validateArtifact(value) {
    const item = exactObject(value, [
      "schemaVersion", "invocationSha256", "finalCheckpointSha256", "source", "sourceFactsArtifactSha256",
      "readerDescription", "coordinateContract", "crop", "pointCounts", "points", "outputBoundsM",
      "invalidPointDisposition", "movableContent", "capabilities", "limitations", "authority", "artifactSha256"
    ], "The selected generated crop");
    requireLiteral(item.schemaVersion, artifactSchema, "schemaVersion");
    requireDigest(item.invocationSha256, "invocationSha256");
    requireDigest(item.finalCheckpointSha256, "finalCheckpointSha256");
    const exactSource = source(item.source, "source");
    requireDigest(item.sourceFactsArtifactSha256, "sourceFactsArtifactSha256");
    const exactReader = await readerDescription(item.readerDescription, exactSource);
    coordinateContract(item.coordinateContract, "coordinateContract");
    const exactCrop = crop(item.crop, "crop");
    const readerCoordinates = exactReader.coordinateContract;
    if (
      item.coordinateContract.inputPointFrame !== readerCoordinates.pointFrame ||
      item.coordinateContract.scanPoseConvention !== readerCoordinates.poseConvention ||
      item.coordinateContract.outputFrame !== readerCoordinates.rootFrame ||
      item.coordinateContract.units !== readerCoordinates.units ||
      item.coordinateContract.axes !== readerCoordinates.axes
    ) fail("The artifact and reader coordinate contracts differ.");
    const counts = exactObject(item.pointCounts, ["source", "processed", "invalid", "croppedOut", "accepted"], "pointCounts");
    requireInteger(counts.source, "pointCounts.source", 1, 1000000);
    requireInteger(counts.processed, "pointCounts.processed", 1, 1000000);
    requireInteger(counts.invalid, "pointCounts.invalid", 0, 1000000);
    requireInteger(counts.croppedOut, "pointCounts.croppedOut", 0, 1000000);
    requireInteger(counts.accepted, "pointCounts.accepted", 0, maximumPoints);
    if (!Array.isArray(item.points)) fail("points must be an array.");
    if (item.points.length > maximumPoints) fail("The generated crop exceeds the 50,000-point local visual inspection limit. Generate a smaller review crop; no points were opened.");
    const scans = exactReader.scans;
    const scanStarts = [];
    let scanStart = 0;
    for (const exactScan of scans) {
      scanStarts.push(scanStart);
      scanStart += exactScan.pointCount;
    }
    let previousOrdinal = -1;
    const pointCoordinates = item.points.map((entry, index) => {
      const parsed = outputPoint(entry, index, scans, scanStarts, exactCrop);
      if (parsed.ordinal <= previousOrdinal) fail("points must be unique and source ordered.");
      previousOrdinal = parsed.ordinal;
      return parsed.coordinates;
    });
    if (
      counts.source !== counts.processed ||
      counts.processed !== counts.invalid + counts.croppedOut + counts.accepted ||
      counts.accepted !== item.points.length ||
      counts.source !== exactReader.totalPointCount
    ) fail("The generated crop point counts do not balance.");
    const exactOutputBounds = item.outputBoundsM === null ? null : bounds(item.outputBoundsM, "outputBoundsM");
    if (!sameCanonical(exactOutputBounds, computedBounds(pointCoordinates))) fail("The generated crop output bounds do not match its exact points.");
    requireLiteral(item.invalidPointDisposition, "cartesianInvalidState_nonzero_excluded", "invalidPointDisposition");
    movableContent(item.movableContent);
    artifactCapabilities(item.capabilities);
    if (!sameCanonical(item.limitations, expectedLimitations)) fail("The generated crop limitation policy differs from the reviewed V0 contract.");
    requireLiteral(item.authority, "none", "authority");
    requireDigest(item.artifactSha256, "artifactSha256");
    const expectedArtifactSha256 = await sha256(artifactDigestDomain, without(item, "artifactSha256"), "\0");
    requireLiteral(item.artifactSha256, expectedArtifactSha256, "artifactSha256");
    return item;
  }

  function compatibleArtifacts(primary, comparison) {
    if (primary.artifactSha256 === comparison.artifactSha256) return false;
    return sameCanonical(
      {
        sha256: primary.source.sha256,
        sizeBytes: primary.source.sizeBytes,
        inputType: primary.source.inputType,
        sourceFactsArtifactSha256: primary.sourceFactsArtifactSha256,
        coordinateContract: primary.coordinateContract
      },
      {
        sha256: comparison.source.sha256,
        sizeBytes: comparison.source.sizeBytes,
        inputType: comparison.source.inputType,
        sourceFactsArtifactSha256: comparison.sourceFactsArtifactSha256,
        coordinateContract: comparison.coordinateContract
      }
    );
  }

  async function artifactFromFile(file, label) {
    if (!file || typeof file.name !== "string") fail("Choose exactly one local JSON file for " + label + ".");
    if (!file.name.toLowerCase().endsWith(".json")) fail(label + " must be a .json file generated by the bounded E57 crop worker.");
    if (file.type && file.type !== "application/json") fail(label + " has a non-JSON media type.");
    if (file.size < 2 || file.size > maximumFileBytes) fail(label + " must be between 2 bytes and the 12 MiB local inspection limit.");
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== file.size || bytes.byteLength > maximumFileBytes) fail(label + " changed or exceeded its byte limit while being read.");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail(label + " is not strict UTF-8 JSON.");
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      fail(label + " is not valid JSON.");
    }
    return validateArtifact(parsed);
  }

  const primaryFile = byId("primary-crop-file");
  const comparisonFile = byId("comparison-crop-file");
  const primaryDrop = byId("primary-crop-drop");
  const comparisonDrop = byId("comparison-crop-drop");
  const visualError = byId("visual-load-error");
  const visualStatus = byId("visual-load-status");
  const visualSurface = byId("point-visual-surface");
  const canvas = byId("point-crop-canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) fail("This browser cannot create the bounded local point preview.");
  let primaryArtifact = null;
  let comparisonArtifact = null;
  let annotations = [];
  let visualDraft = null;
  let maskRules = [];
  let classificationMask = null;
  let maskRequestEpoch = 0;
  let activeMaskRequest = null;
  let primaryLoadEpoch = 0;
  let comparisonLoadEpoch = 0;
  let reviewStateRevision = 0;
  let draftSubmitEpoch = 0;
  let renderQueued = false;
  let previewControlsValid = true;
  let activePointerId = null;
  let lastPointer = null;
  const camera = { yawDegrees: 28, pitchDegrees: -24, zoom: 1, targetM: [0, 0, 0] };

  function showError(target, message) {
    target.textContent = message;
    target.hidden = false;
    target.focus();
  }

  function clearError(target) {
    target.textContent = "";
    target.hidden = true;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function appendFact(target, label, value) {
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", value));
    target.append(row);
  }

  function invalidateDraft() {
    reviewStateRevision += 1;
    draftSubmitEpoch += 1;
    visualDraft = null;
    byId("visual-draft-result").hidden = true;
  }

  function invalidateClassificationMask(statusText) {
    maskRequestEpoch += 1;
    if (activeMaskRequest) activeMaskRequest.abort();
    activeMaskRequest = null;
    classificationMask = null;
    byId("classification-mask-result").hidden = true;
    byId("classification-mask-sha").textContent = "";
    byId("mask-rule-counts").replaceChildren();
    clearError(byId("mask-compile-error"));
    if (statusText) byId("mask-compile-status").textContent = statusText;
    syncMaskAvailability();
  }

  function currentOpacity() {
    const rawValue = byId("comparison-opacity").value.trim();
    if (rawValue === "") fail("Comparison opacity is required and cannot be blank.");
    return requireNumber(Number(rawValue), "Comparison opacity", 0, 1);
  }

  function comparisonIsEffectivelyVisible() {
    return Boolean(
      comparisonArtifact &&
      comparisonArtifact.points.length > 0 &&
      byId("comparison-visible").checked &&
      currentOpacity() >= minimumEffectiveComparisonOpacity
    );
  }

  function updateArtifactFacts() {
    const target = byId("visual-artifact-facts");
    target.replaceChildren();
    if (!primaryArtifact) return;
    appendFact(target, "Primary crop", primaryArtifact.artifactSha256);
    appendFact(target, "Source", primaryArtifact.source.sha256);
    appendFact(target, "Frame", "E57 root · metres · right-handed Z-up");
    appendFact(target, "Accepted points", primaryArtifact.points.length.toLocaleString());
    appendFact(target, "Movable content", "Possible and retained · authority none");
    appendFact(target, "Comparison", comparisonArtifact ? comparisonArtifact.artifactSha256 : "Not loaded");
  }

  function setBoundInputs(exactBounds) {
    const values = [...exactBounds.minimum, ...exactBounds.maximum];
    const ids = [
      "visual-bound-min-x", "visual-bound-min-y", "visual-bound-min-z",
      "visual-bound-max-x", "visual-bound-max-y", "visual-bound-max-z"
    ];
    ids.forEach((id, index) => { byId(id).value = String(values[index]); });
  }

  function resetCorrectionInputs() {
    for (const id of [
      "visual-translate-x", "visual-translate-y", "visual-translate-z",
      "visual-rotate-x", "visual-rotate-y", "visual-rotate-z"
    ]) {
      byId(id).value = "0";
    }
    byId("visual-scale").value = "1";
  }

  function resetDecisionInputs() {
    for (const card of byId("visual-decision-grid").querySelectorAll("[data-visual-dimension-id]")) {
      card.querySelector('[data-role="visual-observation"]').value = "not_assessed";
      card.querySelector('[data-role="visual-decision-note"]').value = "";
    }
  }

  function clearActivePointer() {
    const pointerId = activePointerId;
    activePointerId = null;
    lastPointer = null;
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
  }

  function resetArtifactBoundReviewState(exactBounds) {
    annotations = [];
    clearActivePointer();
    previewControlsValid = true;
    resetDecisionInputs();
    resetCorrectionInputs();
    if (exactBounds) setBoundInputs(exactBounds);
    byId("visual-annotation-note").value = "";
    byId("comparison-visible").checked = true;
    byId("comparison-opacity").value = "0.55";
    invalidateDraft();
    renderAnnotations();
    syncVisualDecisionAvailability();
  }

  function fitCamera() {
    if (!primaryArtifact) return;
    const exactBounds = primaryArtifact.outputBoundsM || {
      minimum: primaryArtifact.crop.minimum,
      maximum: primaryArtifact.crop.maximum
    };
    camera.targetM = exactBounds.minimum.map((minimum, index) => (minimum + exactBounds.maximum[index]) / 2);
    camera.yawDegrees = 28;
    camera.pitchDegrees = -24;
    camera.zoom = 1;
    scheduleRender();
  }

  function normalizeYawDegrees(value) {
    const normalized = ((value + 180) % 360 + 360) % 360 - 180;
    return Object.is(normalized, -0) ? 0 : normalized;
  }

  function resetVisualState() {
    primaryLoadEpoch += 1;
    comparisonLoadEpoch += 1;
    primaryArtifact = null;
    comparisonArtifact = null;
    primaryFile.value = "";
    comparisonFile.value = "";
    resetMaskAuthoring(null);
    resetArtifactBoundReviewState(null);
    updateArtifactFacts();
    visualSurface.hidden = true;
    visualStatus.textContent = "No generated crop is open.";
    clearError(visualError);
  }

  function clearComparison() {
    comparisonLoadEpoch += 1;
    comparisonArtifact = null;
    comparisonFile.value = "";
    resetArtifactBoundReviewState(primaryArtifact ? primaryArtifact.crop : null);
    byId("comparison-controls").hidden = true;
    byId("comparison-legend").hidden = true;
    updateArtifactFacts();
    scheduleRender();
  }

  async function openArtifact(file, role) {
    const requestEpoch = role === "primary"
      ? ++primaryLoadEpoch
      : ++comparisonLoadEpoch;
    if (role === "primary") {
      comparisonLoadEpoch += 1;
      resetMaskAuthoring(null);
    }
    const boundPrimaryArtifactSha256 = role === "comparison" && primaryArtifact
      ? primaryArtifact.artifactSha256
      : null;
    const requestIsCurrent = () => role === "primary"
      ? requestEpoch === primaryLoadEpoch
      : requestEpoch === comparisonLoadEpoch &&
        (boundPrimaryArtifactSha256 === null
          ? primaryArtifact === null
          : primaryArtifact !== null &&
            primaryArtifact.artifactSha256 === boundPrimaryArtifactSha256);
    invalidateDraft();
    clearError(visualError);
    const label = role === "primary" ? "The primary generated crop" : "The comparison generated crop";
    try {
      if (role === "comparison" && boundPrimaryArtifactSha256 === null) {
        fail("Open a primary generated crop before choosing a comparison.");
      }
      const artifact = await artifactFromFile(file, label);
      if (!requestIsCurrent()) return;
      if (role === "primary") {
        comparisonLoadEpoch += 1;
        primaryArtifact = artifact;
        comparisonArtifact = null;
        comparisonFile.value = "";
        resetMaskAuthoring(artifact);
        resetArtifactBoundReviewState(artifact.crop);
        fitCamera();
      } else {
        if (!primaryArtifact) return;
        if (!compatibleArtifacts(primaryArtifact, artifact)) {
          fail("Comparison overlay requires a distinct artifact from the same exact source bytes, source-facts digest, frame, axes, and units. Cross-source overlays need reviewed registration evidence.");
        }
        comparisonArtifact = artifact;
        resetArtifactBoundReviewState(primaryArtifact.crop);
      }
      updateArtifactFacts();
      const hasComparison = comparisonArtifact !== null;
      byId("comparison-controls").hidden = !hasComparison;
      byId("comparison-legend").hidden = !hasComparison;
      visualSurface.hidden = false;
      visualStatus.textContent = hasComparison
        ? "Two compatible generated crop artifacts are open in browser memory. Loading them did not transfer either file."
        : "One validated generated crop artifact is open in browser memory. Loading it did not transfer the file.";
      invalidateDraft();
      scheduleRender();
      visualSurface.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (!requestIsCurrent()) return;
      if (role === "comparison") comparisonFile.value = "";
      showError(visualError, error instanceof Error ? error.message : label + " could not be opened safely.");
    }
  }

  function bindDropZone(zone, role) {
    for (const eventName of ["dragenter", "dragover"]) {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        zone.classList.add("is-dragging");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      zone.addEventListener(eventName, (event) => {
        event.preventDefault();
        zone.classList.remove("is-dragging");
      });
    }
    zone.addEventListener("drop", (event) => {
      const files = event.dataTransfer ? event.dataTransfer.files : null;
      if (!files || files.length !== 1) {
        showError(visualError, "Drop exactly one generated crop JSON file at a time.");
        return;
      }
      void openArtifact(files[0], role);
    });
  }

  primaryFile.addEventListener("change", () => {
    const file = primaryFile.files && primaryFile.files[0];
    if (file) void openArtifact(file, "primary");
  });
  comparisonFile.addEventListener("change", () => {
    const file = comparisonFile.files && comparisonFile.files[0];
    if (file) void openArtifact(file, "comparison");
  });
  bindDropZone(primaryDrop, "primary");
  bindDropZone(comparisonDrop, "comparison");
  byId("clear-primary-crop").addEventListener("click", resetVisualState);
  byId("clear-comparison-crop").addEventListener("click", clearComparison);

  function numericValue(id, label, minimum, maximum) {
    const rawValue = byId(id).value.trim();
    if (rawValue === "") fail(label + " is required and cannot be blank.");
    return requireNumber(Number(rawValue), label, minimum, maximum);
  }

  function setMaskBoundInputs(exactBounds) {
    const ids = [
      "mask-min-x", "mask-min-y", "mask-min-z",
      "mask-max-x", "mask-max-y", "mask-max-z"
    ];
    const values = exactBounds
      ? [...exactBounds.minimum, ...exactBounds.maximum]
      : ["", "", "", "", "", ""];
    ids.forEach((id, index) => { byId(id).value = String(values[index]); });
  }

  function maskStatusForCurrentState() {
    if (!primaryArtifact) return "Open a non-empty generated crop and add at least one rule.";
    if (primaryArtifact.points.length === 0) return "A zero-point crop cannot produce a classification mask.";
    if (maskRules.length === 0) return "Add at least one raw-frame movable or privacy rule.";
    return String(maskRules.length) + " rule" + (maskRules.length === 1 ? " is" : "s are") + " ready for local compilation.";
  }

  function syncMaskAvailability() {
    const artifactAvailable = Boolean(primaryArtifact && primaryArtifact.points.length > 0);
    byId("add-mask-rule").disabled = !artifactAvailable;
    byId("compile-classification-mask").disabled = !artifactAvailable || maskRules.length === 0;
  }

  function resetMaskRuleInputs() {
    byId("mask-rule-id").value = "";
    byId("mask-rule-classification").value = "captured_movable_visual_excluded";
    byId("mask-selection-kind").value = "inclusive_bounds_e57_root_m";
    byId("mask-exact-references").value = "";
    byId("mask-rule-rationale").value = "";
    syncMaskSelectionFields();
  }

  function resetMaskAuthoring(artifact) {
    maskRules = [];
    resetMaskRuleInputs();
    setMaskBoundInputs(artifact ? (artifact.outputBoundsM || artifact.crop) : null);
    renderMaskRules();
    invalidateClassificationMask(
      artifact ? maskStatusForCurrentState() : "Open a non-empty generated crop and add at least one rule."
    );
  }

  function syncMaskSelectionFields() {
    const exact = byId("mask-selection-kind").value === "exact_point_references";
    byId("mask-bounds-fields").hidden = exact;
    byId("mask-exact-fields").hidden = !exact;
  }

  function parseExactPointReferences() {
    const raw = byId("mask-exact-references").value.trim();
    if (raw === "") fail("Exact selection requires at least one scanIndex:sourcePointIndex line.");
    const lines = raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 1 || lines.length > maximumPoints) {
      fail("Exact selection must contain between 1 and 50,000 retained-point references.");
    }
    const seen = new Set();
    return lines.map((line) => {
      const match = /^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/u.exec(line);
      if (!match) fail("Exact references must use one non-negative scanIndex:sourcePointIndex pair per line.");
      const scanIndex = Number(match[1]);
      const sourcePointIndex = Number(match[2]);
      if (!Number.isSafeInteger(scanIndex) || !Number.isSafeInteger(sourcePointIndex)) {
        fail("Exact reference indices must be safe non-negative integers.");
      }
      const key = String(scanIndex) + ":" + String(sourcePointIndex);
      if (seen.has(key)) fail("Exact retained-point references must be unique within a rule.");
      seen.add(key);
      return { scanIndex, sourcePointIndex };
    });
  }

  function currentMaskRule() {
    if (!primaryArtifact || primaryArtifact.points.length === 0) {
      fail("Open a non-empty validated generated crop before adding a mask rule.");
    }
    const ruleId = byId("mask-rule-id").value.trim();
    if (!maskRuleIdPattern.test(ruleId)) {
      fail("Rule ID must use 1 to 120 lowercase letters, numbers, dots, underscores, or hyphens and start with a letter or number.");
    }
    if (maskRules.some((rule) => rule.ruleId === ruleId)) fail("Mask rule IDs must be unique.");
    const classification = byId("mask-rule-classification").value;
    if (
      classification !== "captured_movable_visual_excluded" &&
      classification !== "privacy_excluded"
    ) fail("Choose either movable captured content or privacy exclusion.");
    const rationale = byId("mask-rule-rationale").value.trim();
    if (rationale.length < 20 || rationale.length > 1000) {
      fail("Rule rationale must contain 20 to 1000 characters.");
    }
    const selectionKind = byId("mask-selection-kind").value;
    let selection;
    if (selectionKind === "exact_point_references") {
      selection = { kind: "exact_point_references", points: parseExactPointReferences() };
    } else if (selectionKind === "inclusive_bounds_e57_root_m") {
      const minimum = [
        numericValue("mask-min-x", "Raw mask minimum X", -maximumCoordinate, maximumCoordinate),
        numericValue("mask-min-y", "Raw mask minimum Y", -maximumCoordinate, maximumCoordinate),
        numericValue("mask-min-z", "Raw mask minimum Z", -maximumCoordinate, maximumCoordinate)
      ];
      const maximum = [
        numericValue("mask-max-x", "Raw mask maximum X", -maximumCoordinate, maximumCoordinate),
        numericValue("mask-max-y", "Raw mask maximum Y", -maximumCoordinate, maximumCoordinate),
        numericValue("mask-max-z", "Raw mask maximum Z", -maximumCoordinate, maximumCoordinate)
      ];
      if (minimum.some((member, index) => member > maximum[index])) {
        fail("Raw E57-root mask minimum bounds cannot exceed maximum bounds.");
      }
      selection = {
        kind: "inclusive_bounds_e57_root_m",
        frame: "e57_root",
        units: "metre",
        minimum,
        maximum
      };
    } else {
      fail("Choose raw E57-root bounds or exact retained-point references.");
    }
    return { ruleId, classification, rationale, selection };
  }

  function maskClassificationLabel(value) {
    return value === "privacy_excluded" ? "Privacy exclusion" : "Movable captured content";
  }

  function maskSelectionLabel(selection) {
    if (selection.kind === "exact_point_references") {
      return String(selection.points.length) + " exact retained-point reference" + (selection.points.length === 1 ? "" : "s");
    }
    return "Raw E57-root AABB " + selection.minimum.join(", ") + " → " + selection.maximum.join(", ") + " metres";
  }

  function renderMaskRules() {
    const target = byId("mask-rule-list");
    target.replaceChildren();
    maskRules.forEach((rule, index) => {
      const item = element("li");
      const copy = element("div");
      copy.append(
        element("strong", "", rule.ruleId + " · " + maskClassificationLabel(rule.classification)),
        element("p", "", maskSelectionLabel(rule.selection) + ". Matched count pending shared local compilation."),
        element("p", "", rule.rationale)
      );
      const remove = element("button", "button button-secondary", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove mask rule " + rule.ruleId);
      remove.addEventListener("click", () => {
        maskRules = maskRules.filter((_, currentIndex) => currentIndex !== index);
        renderMaskRules();
        invalidateClassificationMask(maskStatusForCurrentState());
      });
      item.append(copy, remove);
      target.append(item);
    });
    syncMaskAvailability();
  }

  function currentMaskAuthorship() {
    const operatorId = byId("mask-operator-id").value.trim();
    const operatorDisplayName = byId("mask-operator-name").value.trim();
    const purposeNote = byId("mask-purpose-note").value.trim();
    if (operatorId.length < 2 || operatorId.length > 160) {
      fail("Operator reference must contain 2 to 160 characters.");
    }
    if (operatorDisplayName.length < 2 || operatorDisplayName.length > 160) {
      fail("Operator display name must contain 2 to 160 characters.");
    }
    if (purposeNote.length < 20 || purposeNote.length > 1000) {
      fail("Mask purpose note must contain 20 to 1000 characters.");
    }
    return {
      operatorId,
      operatorDisplayName,
      authoredAt: new Date().toISOString(),
      purposeNote,
      identityAuthority: "caller_supplied_unverified"
    };
  }

  function cloneMaskRule(rule) {
    return {
      ruleId: rule.ruleId,
      classification: rule.classification,
      rationale: rule.rationale,
      selection: rule.selection.kind === "exact_point_references"
        ? {
            kind: "exact_point_references",
            points: rule.selection.points.map((point) => ({
              scanIndex: point.scanIndex,
              sourcePointIndex: point.sourcePointIndex
            }))
          }
        : {
            kind: "inclusive_bounds_e57_root_m",
            frame: "e57_root",
            units: "metre",
            minimum: [...rule.selection.minimum],
            maximum: [...rule.selection.maximum]
          }
    };
  }

  function snapshotMaskRequest() {
    if (!primaryArtifact || primaryArtifact.points.length === 0) {
      fail("Open a non-empty validated generated crop before compiling a mask.");
    }
    if (maskRules.length < 1 || maskRules.length > maximumMaskRules) {
      fail("A local mask requires between 1 and 256 bounded rules.");
    }
    if (typeof localSessionToken !== "string" || !localSessionTokenPattern.test(localSessionToken)) {
      fail("This local session token is missing or expired. Reopen the Foundry local-session link.");
    }
    const authorship = currentMaskAuthorship();
    const rules = maskRules.map(cloneMaskRule);
    const request = {
      schemaVersion: maskRequestSchema,
      artifact: primaryArtifact,
      authorship,
      defaultClassification: "unclassified_static_candidate",
      rules
    };
    const serialized = JSON.stringify(request);
    const bodyBytes = new TextEncoder().encode(serialized).byteLength;
    if (bodyBytes > maximumMaskRequestBytes) {
      fail("The crop and exact rules exceed the 16 MiB local mask request limit. Use fewer exact references or a smaller generated crop.");
    }
    return {
      artifactSha256: primaryArtifact.artifactSha256,
      artifactPointCount: primaryArtifact.points.length,
      authorship,
      rules,
      serialized
    };
  }

  async function boundedResponseJson(response) {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      if (!/^[0-9]+$/u.test(declaredLength) || Number(declaredLength) > maximumMaskResponseBytes) {
        fail("The local mask response exceeded its 64 MiB browser limit.");
      }
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maximumMaskResponseBytes) {
      fail("The local mask response exceeded its 64 MiB browser limit.");
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("The local mask response was not strict UTF-8 JSON.");
    }
    try {
      return JSON.parse(text);
    } catch {
      fail("The local mask response was not valid JSON.");
    }
  }

  function requireNonnegativeCount(value, label) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximumPoints) {
      fail(label + " is outside the bounded retained-point count.");
    }
    return value;
  }

  async function validateClassificationMaskResponse(value, snapshot) {
    const mask = exactObject(value, [
      "schemaVersion", "status", "maskInputSha256", "subject", "authorship",
      "defaultClassification", "classificationRules", "points", "classificationCounts",
      "completeness", "coordinateRuleBoundary", "reviewStatus", "releaseEligibility",
      "releaseBlockers", "authority", "capabilities", "verificationBoundary", "maskSha256"
    ], "Local classification mask");
    requireLiteral(mask.schemaVersion, maskSchema, "mask.schemaVersion");
    requireLiteral(mask.status, "local_operator_authored_classification_draft", "mask.status");
    requireLiteral(mask.defaultClassification, "unclassified_static_candidate", "mask.defaultClassification");
    requireLiteral(mask.completeness, "every_retained_crop_point_classified_exactly_once", "mask.completeness");
    requireLiteral(mask.coordinateRuleBoundary, "aabb_rules_apply_only_in_original_e57_root_metres_without_preview_correction", "mask.coordinateRuleBoundary");
    requireLiteral(mask.reviewStatus, "not_reviewed", "mask.reviewStatus");
    requireLiteral(mask.releaseEligibility, "blocked", "mask.releaseEligibility");
    requireDigest(mask.maskInputSha256, "mask.maskInputSha256");
    requireDigest(mask.maskSha256, "mask.maskSha256");
    if (!sameCanonical(mask.authorship, snapshot.authorship)) fail("The local mask response changed its exact caller-supplied authorship.");

    const subject = record(mask.subject, "Mask subject");
    requireLiteral(subject.artifactSha256, snapshot.artifactSha256, "mask.subject.artifactSha256");
    requireLiteral(subject.frame, "e57_root", "mask.subject.frame");
    requireLiteral(subject.units, "metre", "mask.subject.units");
    requireLiteral(subject.axes, "right_handed_z_up", "mask.subject.axes");
    requireLiteral(subject.sourceRetainedPointCount, snapshot.artifactPointCount, "mask.subject.sourceRetainedPointCount");

    const expectedAuthority = {
      pointClassification: "caller_supplied_unverified",
      architecturalGeometry: "none",
      placement: "none",
      measurement: "none",
      collision: "none",
      export: "none",
      runtime: "none"
    };
    if (!sameCanonical(mask.authority, expectedAuthority)) fail("The local mask response attempted to claim authority.");
    const expectedCapabilities = {
      localAuthorityNoneFusionExclusion: "allowed",
      sourceMutation: "not_authorized",
      transformArtifactCreation: "not_authorized",
      sceneAuthorityCreation: "not_authorized",
      qaApproval: "not_authorized",
      packageExport: "not_authorized",
      runtimeActivation: "not_authorized"
    };
    if (!sameCanonical(mask.capabilities, expectedCapabilities)) fail("The local mask response changed its not-authorized capability boundary.");
    if (!sameCanonical(mask.releaseBlockers, [
      "AUTHORED_CLASSIFICATION_REVIEW_REQUIRED",
      "SCENE_AUTHORITY_MAP_REQUIRED",
      "TRANSFORM_ARTIFACT_REQUIRED"
    ])) fail("The local mask response changed its release blockers.");

    if (!Array.isArray(mask.classificationRules) || mask.classificationRules.length !== snapshot.rules.length) {
      fail("The local mask response did not bind the exact rule count.");
    }
    const expectedRules = new Map(snapshot.rules.map((rule) => [rule.ruleId, rule]));
    for (const returnedRule of mask.classificationRules) {
      const rule = record(returnedRule, "Compiled classification rule");
      const expected = expectedRules.get(rule.ruleId);
      if (
        !expected ||
        rule.classification !== expected.classification ||
        rule.rationale !== expected.rationale
      ) fail("The local mask response changed an exact rule identity or meaning.");
    }

    if (!Array.isArray(mask.points) || mask.points.length !== snapshot.artifactPointCount) {
      fail("The local mask response did not enumerate every retained crop point exactly once.");
    }
    const ruleCounts = new Map(snapshot.rules.map((rule) => [rule.ruleId, 0]));
    const computedCounts = {
      sourceRetainedPoints: mask.points.length,
      capturedMovableVisualExcluded: 0,
      privacyExcluded: 0,
      unclassifiedStaticCandidate: 0
    };
    for (const pointValue of mask.points) {
      const point = record(pointValue, "Classified point");
      if (point.classification === "captured_movable_visual_excluded") {
        computedCounts.capturedMovableVisualExcluded += 1;
      } else if (point.classification === "privacy_excluded") {
        computedCounts.privacyExcluded += 1;
      } else if (point.classification === "unclassified_static_candidate") {
        computedCounts.unclassifiedStaticCandidate += 1;
      } else {
        fail("The local mask response contains an unsupported point classification.");
      }
      const origin = record(point.classificationOrigin, "Point classification origin");
      if (origin.kind === "operator_rule") {
        const count = ruleCounts.get(origin.ruleId);
        if (count === undefined) fail("A classified point names a rule outside this exact request.");
        ruleCounts.set(origin.ruleId, count + 1);
      } else if (
        origin.kind !== "declared_default" ||
        origin.ruleId !== null ||
        point.classification !== "unclassified_static_candidate"
      ) {
        fail("A classified point has an invalid default origin.");
      }
      requireLiteral(point.authority, "none", "classified point authority");
    }
    for (const [ruleId, count] of ruleCounts) {
      if (count < 1) fail("Compiled rule " + ruleId + " matched no retained crop points.");
    }
    const counts = exactObject(mask.classificationCounts, [
      "sourceRetainedPoints", "capturedMovableVisualExcluded", "privacyExcluded", "unclassifiedStaticCandidate"
    ], "Mask classification counts");
    for (const [key, expected] of Object.entries(computedCounts)) {
      requireLiteral(requireNonnegativeCount(counts[key], "Mask " + key), expected, "mask.classificationCounts." + key);
    }

    const expectedMaskSha256 = await sha256(maskDigestDomain, without(mask, "maskSha256"), "\0");
    requireLiteral(mask.maskSha256, expectedMaskSha256, "mask.maskSha256");
    return { mask, ruleCounts };
  }

  function renderClassificationMaskResult(validated) {
    const mask = validated.mask;
    byId("classification-mask-sha").textContent = mask.maskSha256;
    byId("mask-movable-count").textContent = String(mask.classificationCounts.capturedMovableVisualExcluded);
    byId("mask-privacy-count").textContent = String(mask.classificationCounts.privacyExcluded);
    byId("mask-static-count").textContent = String(mask.classificationCounts.unclassifiedStaticCandidate);
    const countsTarget = byId("mask-rule-counts");
    countsTarget.replaceChildren();
    for (const rule of maskRules) {
      const count = validated.ruleCounts.get(rule.ruleId) || 0;
      const item = element("li");
      const copy = element("div");
      copy.append(
        element("strong", "", rule.ruleId + " · " + count.toLocaleString() + " matched point" + (count === 1 ? "" : "s")),
        element("p", "", maskClassificationLabel(rule.classification) + " · raw E57-root selection · not reviewed")
      );
      item.append(copy);
      countsTarget.append(item);
    }
    byId("classification-mask-result").hidden = false;
  }

  byId("mask-selection-kind").addEventListener("change", () => {
    syncMaskSelectionFields();
    invalidateClassificationMask("Rule editor changed. Recompile after adding the intended raw-frame rule.");
  });
  const maskDraftInputIds = [
    "mask-rule-id", "mask-rule-classification", "mask-min-x", "mask-min-y", "mask-min-z",
    "mask-max-x", "mask-max-y", "mask-max-z", "mask-exact-references", "mask-rule-rationale",
    "mask-operator-id", "mask-operator-name", "mask-purpose-note"
  ];
  for (const id of maskDraftInputIds) {
    for (const eventName of ["input", "change"]) {
      byId(id).addEventListener(eventName, () => {
        invalidateClassificationMask("Mask inputs changed. Compile a fresh result after the rules and authorship are complete.");
      });
    }
  }

  byId("add-mask-rule").addEventListener("click", () => {
    const target = byId("mask-rule-error");
    clearError(target);
    try {
      if (maskRules.length >= maximumMaskRules) fail("The local mask is limited to 256 rules.");
      maskRules = [...maskRules, currentMaskRule()];
      renderMaskRules();
      resetMaskRuleInputs();
      invalidateClassificationMask(maskStatusForCurrentState());
    } catch (error) {
      showError(target, error instanceof Error ? error.message : "The raw-frame mask rule is invalid.");
    }
  });

  byId("compile-classification-mask").addEventListener("click", async () => {
    invalidateClassificationMask("Preparing the explicit local loopback request…");
    const requestEpoch = maskRequestEpoch;
    const controller = new AbortController();
    activeMaskRequest = controller;
    try {
      const snapshot = snapshotMaskRequest();
      byId("mask-compile-status").textContent = "Compiling with the shared verifier in this 127.0.0.1 process. No external upload or persistence is occurring.";
      const response = await fetch(
        maskRoute + "?token=" + encodeURIComponent(localSessionToken),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: snapshot.serialized,
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal
        }
      );
      const responseBody = await boundedResponseJson(response);
      if (requestEpoch !== maskRequestEpoch) return;
      if (!response.ok) {
        const errorBody = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)
          ? responseBody
          : null;
        fail(errorBody && typeof errorBody.error === "string"
          ? errorBody.error
          : "The local shared compiler refused this mask request.");
      }
      const validated = await validateClassificationMaskResponse(responseBody, snapshot);
      if (requestEpoch !== maskRequestEpoch) return;
      classificationMask = validated.mask;
      renderClassificationMaskResult(validated);
      byId("mask-compile-status").textContent = "Mask compiled and verified locally. Matched counts are shown below; review status remains not reviewed and authority remains none.";
      byId("classification-mask-result").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      if (requestEpoch !== maskRequestEpoch || (error && error.name === "AbortError")) return;
      classificationMask = null;
      byId("classification-mask-result").hidden = true;
      byId("mask-compile-status").textContent = "No mask is available for download.";
      showError(
        byId("mask-compile-error"),
        error instanceof Error ? error.message : "The local classification mask could not be compiled safely."
      );
    } finally {
      if (requestEpoch === maskRequestEpoch) activeMaskRequest = null;
    }
  });

  byId("download-classification-mask").addEventListener("click", () => {
    if (!classificationMask) return;
    const blob = new Blob([JSON.stringify(classificationMask, null, 2) + "\n"], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = element("a");
    anchor.href = objectUrl;
    anchor.download = "foundry-e57-point-classification-mask-v0.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  });

  function currentCorrection() {
    return {
      translationM: [
        numericValue("visual-translate-x", "Preview translation X", -maximumCoordinate, maximumCoordinate),
        numericValue("visual-translate-y", "Preview translation Y", -maximumCoordinate, maximumCoordinate),
        numericValue("visual-translate-z", "Preview translation Z", -maximumCoordinate, maximumCoordinate)
      ],
      rotationDegrees: [
        numericValue("visual-rotate-x", "Preview rotation X", -3600, 3600),
        numericValue("visual-rotate-y", "Preview rotation Y", -3600, 3600),
        numericValue("visual-rotate-z", "Preview rotation Z", -3600, 3600)
      ],
      scaleMultiplier: numericValue("visual-scale", "Preview scale", 0.001, 1000)
    };
  }

  function currentBounds() {
    const parsed = {
      minimum: [
        numericValue("visual-bound-min-x", "Annotation minimum X", -maximumCoordinate, maximumCoordinate),
        numericValue("visual-bound-min-y", "Annotation minimum Y", -maximumCoordinate, maximumCoordinate),
        numericValue("visual-bound-min-z", "Annotation minimum Z", -maximumCoordinate, maximumCoordinate)
      ],
      maximum: [
        numericValue("visual-bound-max-x", "Annotation maximum X", -maximumCoordinate, maximumCoordinate),
        numericValue("visual-bound-max-y", "Annotation maximum Y", -maximumCoordinate, maximumCoordinate),
        numericValue("visual-bound-max-z", "Annotation maximum Z", -maximumCoordinate, maximumCoordinate)
      ]
    };
    if (parsed.minimum.some((member, index) => member > parsed.maximum[index])) fail("Annotation minimum bounds cannot exceed maximum bounds.");
    return parsed;
  }

  function createProjector(correction, width, height, pixelsPerMetre) {
    const rx = correction.rotationDegrees[0] * Math.PI / 180;
    const ry = correction.rotationDegrees[1] * Math.PI / 180;
    const rz = correction.rotationDegrees[2] * Math.PI / 180;
    const yaw = camera.yawDegrees * Math.PI / 180;
    const pitch = camera.pitchDegrees * Math.PI / 180;
    const sinRx = Math.sin(rx);
    const cosRx = Math.cos(rx);
    const sinRy = Math.sin(ry);
    const cosRy = Math.cos(ry);
    const sinRz = Math.sin(rz);
    const cosRz = Math.cos(rz);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const sinPitch = Math.sin(pitch);
    const cosPitch = Math.cos(pitch);
    const rotation = [
      [cosRz * cosRy, cosRz * sinRy * sinRx - sinRz * cosRx, cosRz * sinRy * cosRx + sinRz * sinRx],
      [sinRz * cosRy, sinRz * sinRy * sinRx + cosRz * cosRx, sinRz * sinRy * cosRx - cosRz * sinRx],
      [-sinRy, cosRy * sinRx, cosRy * cosRx]
    ];
    const horizontalCoefficients = rotation[0].map((member, index) =>
      correction.scaleMultiplier * (cosYaw * member - sinYaw * rotation[1][index])
    );
    const verticalCoefficients = rotation[0].map((member, index) =>
      correction.scaleMultiplier * (
        sinPitch * (sinYaw * member + cosYaw * rotation[1][index]) +
        cosPitch * rotation[2][index]
      )
    );
    const horizontalOffset = cosYaw * correction.translationM[0] - sinYaw * correction.translationM[1];
    const verticalOffset =
      sinPitch * (sinYaw * correction.translationM[0] + cosYaw * correction.translationM[1]) +
      cosPitch * correction.translationM[2];
    return (point) => {
      const x = point[0] - camera.targetM[0];
      const y = point[1] - camera.targetM[1];
      const z = point[2] - camera.targetM[2];
      const horizontal = horizontalCoefficients[0] * x + horizontalCoefficients[1] * y + horizontalCoefficients[2] * z + horizontalOffset;
      const vertical = verticalCoefficients[0] * x + verticalCoefficients[1] * y + verticalCoefficients[2] * z + verticalOffset;
      return [width / 2 + horizontal * pixelsPerMetre, height / 2 - vertical * pixelsPerMetre];
    };
  }

  function boxCorners(exactBounds) {
    const [minX, minY, minZ] = exactBounds.minimum;
    const [maxX, maxY, maxZ] = exactBounds.maximum;
    return [
      [minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ],
      [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]
    ];
  }

  function drawBounds(exactBounds, projector, color) {
    const corners = boxCorners(exactBounds).map(projector);
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.setLineDash([7, 5]);
    context.beginPath();
    for (const [start, end] of edges) {
      context.moveTo(corners[start][0], corners[start][1]);
      context.lineTo(corners[end][0], corners[end][1]);
    }
    context.stroke();
    context.setLineDash([]);
  }

  function drawPoints(artifact, projector, color, opacity, width, height) {
    context.fillStyle = color;
    context.globalAlpha = opacity;
    const radius = window.devicePixelRatio > 1 ? 1.25 : 1;
    for (const point of artifact.points) {
      const screen = projector([point.xM, point.yM, point.zM]);
      if (screen[0] < -2 || screen[0] > width + 2 || screen[1] < -2 || screen[1] > height + 2) continue;
      context.fillRect(screen[0] - radius / 2, screen[1] - radius / 2, radius, radius);
    }
    context.globalAlpha = 1;
  }

  function render() {
    renderQueued = false;
    if (!primaryArtifact) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = Math.max(1, canvas.clientWidth);
    const cssHeight = Math.max(1, canvas.clientHeight);
    const pixelWidth = Math.round(cssWidth * ratio);
    const pixelHeight = Math.round(cssHeight * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#071112";
    context.fillRect(0, 0, cssWidth, cssHeight);
    let correction;
    let annotationBounds;
    try {
      correction = currentCorrection();
      annotationBounds = currentBounds();
      previewControlsValid = true;
      clearError(byId("visual-annotation-error"));
    } catch (error) {
      previewControlsValid = false;
      showError(
        byId("visual-annotation-error"),
        error instanceof Error
          ? error.message
          : "The preview controls are invalid. Decisions and draft creation are blocked."
      );
      syncVisualDecisionAvailability();
      byId("visual-camera-readout").textContent = "Preview unavailable · correct the highlighted numeric evidence.";
      return;
    }
    syncVisualDecisionAvailability();
    const baseBounds = primaryArtifact.outputBoundsM || primaryArtifact.crop;
    const span = Math.max(
      baseBounds.maximum[0] - baseBounds.minimum[0],
      baseBounds.maximum[1] - baseBounds.minimum[1],
      baseBounds.maximum[2] - baseBounds.minimum[2],
      0.001
    );
    const pixelsPerMetre = Math.min(cssWidth, cssHeight) * 0.72 / span * camera.zoom;
    const projector = createProjector(correction, cssWidth, cssHeight, pixelsPerMetre);
    if (comparisonIsEffectivelyVisible()) {
      drawPoints(comparisonArtifact, projector, "#c495ff", currentOpacity(), cssWidth, cssHeight);
    }
    drawPoints(primaryArtifact, projector, "#7ee0d1", 0.9, cssWidth, cssHeight);
    drawBounds(primaryArtifact.crop, projector, "#f0bd63");
    if (annotationBounds) drawBounds(annotationBounds, projector, "#ff7894");
    byId("visual-camera-readout").textContent =
      "Yaw " + camera.yawDegrees.toFixed(1) + "° · pitch " + camera.pitchDegrees.toFixed(1) + "° · zoom " + camera.zoom.toFixed(2) + "×";
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(render);
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!primaryArtifact || activePointerId !== null) return;
    activePointerId = event.pointerId;
    lastPointer = [event.clientX, event.clientY];
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId || !lastPointer) return;
    const deltaX = event.clientX - lastPointer[0];
    const deltaY = event.clientY - lastPointer[1];
    lastPointer = [event.clientX, event.clientY];
    camera.yawDegrees = normalizeYawDegrees(camera.yawDegrees + deltaX * 0.25);
    camera.pitchDegrees = Math.max(-89, Math.min(89, camera.pitchDegrees + deltaY * 0.25));
    invalidateDraft();
    scheduleRender();
  });
  function releasePointer(event) {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    lastPointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", () => {
    activePointerId = null;
    lastPointer = null;
  });
  canvas.addEventListener("wheel", (event) => {
    if (!primaryArtifact) return;
    event.preventDefault();
    camera.zoom = Math.max(0.01, Math.min(1000, camera.zoom * Math.exp(-event.deltaY * 0.0015)));
    invalidateDraft();
    scheduleRender();
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowLeft") camera.yawDegrees = normalizeYawDegrees(camera.yawDegrees - 5);
    if (event.key === "ArrowRight") camera.yawDegrees = normalizeYawDegrees(camera.yawDegrees + 5);
    if (event.key === "ArrowUp") camera.pitchDegrees = Math.max(-89, camera.pitchDegrees - 5);
    if (event.key === "ArrowDown") camera.pitchDegrees = Math.min(89, camera.pitchDegrees + 5);
    if (event.key === "+" || event.key === "=") camera.zoom = Math.min(1000, camera.zoom * 1.2);
    if (event.key === "-") camera.zoom = Math.max(0.01, camera.zoom / 1.2);
    invalidateDraft();
    scheduleRender();
  });
  byId("visual-reset-view").addEventListener("click", () => { fitCamera(); invalidateDraft(); });
  byId("visual-zoom-in").addEventListener("click", () => { camera.zoom = Math.min(1000, camera.zoom * 1.2); invalidateDraft(); scheduleRender(); });
  byId("visual-zoom-out").addEventListener("click", () => { camera.zoom = Math.max(0.01, camera.zoom / 1.2); invalidateDraft(); scheduleRender(); });
  function comparisonControlChanged() {
    invalidateDraft();
    syncVisualDecisionAvailability();
    scheduleRender();
  }
  byId("comparison-visible").addEventListener("change", comparisonControlChanged);
  byId("comparison-opacity").addEventListener("input", comparisonControlChanged);
  let observedCanvasSize = [canvas.clientWidth, canvas.clientHeight];
  function handleVisualResize() {
    const nextSize = [canvas.clientWidth, canvas.clientHeight];
    if (
      (observedCanvasSize[0] !== nextSize[0] || observedCanvasSize[1] !== nextSize[1])
    ) {
      invalidateDraft();
    }
    observedCanvasSize = nextSize;
    scheduleRender();
  }
  const visualResizeObserver = "ResizeObserver" in globalThis
    ? new globalThis.ResizeObserver(handleVisualResize)
    : null;
  if (visualResizeObserver) visualResizeObserver.observe(canvas);
  window.addEventListener("resize", handleVisualResize);
  window.addEventListener("pagehide", () => { if (visualResizeObserver) visualResizeObserver.disconnect(); }, { once: true });
  window.addEventListener("pageshow", () => {
    observedCanvasSize = [canvas.clientWidth, canvas.clientHeight];
    if (visualResizeObserver) visualResizeObserver.observe(canvas);
    invalidateDraft();
    scheduleRender();
  });
  byId("visual-reviewed-by").addEventListener("input", invalidateDraft);

  const visualInputIds = [
    "visual-translate-x", "visual-translate-y", "visual-translate-z",
    "visual-rotate-x", "visual-rotate-y", "visual-rotate-z", "visual-scale",
    "visual-bound-min-x", "visual-bound-min-y", "visual-bound-min-z",
    "visual-bound-max-x", "visual-bound-max-y", "visual-bound-max-z"
  ];
  for (const id of visualInputIds) {
    byId(id).addEventListener("input", () => { invalidateDraft(); scheduleRender(); });
  }

  function renderDecisionControls() {
    const target = byId("visual-decision-grid");
    const annotationDimension = byId("visual-annotation-dimension");
    target.replaceChildren();
    annotationDimension.replaceChildren();
    for (const [dimensionId, label] of dimensions) {
      const card = element("article", "visual-decision-card");
      card.dataset.visualDimensionId = dimensionId;
      card.append(element("h4", "", label));
      const selectLabel = element("label", "", "Preview observation");
      const select = element("select");
      select.dataset.role = "visual-observation";
      select.setAttribute("aria-label", label + " visual observation");
      for (const [value, copy] of [
        ["not_assessed", "Not assessed"],
        ["no_preview_issue_observed", "No preview issue observed · not approval"],
        ["preview_issue_observed", "Preview issue observed"]
      ]) {
        const option = element("option", "", copy);
        option.value = value;
        select.append(option);
      }
      const noteLabel = element("label", "", "Decision note");
      const note = element("textarea");
      note.dataset.role = "visual-decision-note";
      note.rows = 2;
      note.maxLength = 1000;
      note.setAttribute("aria-label", label + " visual decision note");
      note.placeholder = "Required only when a preview observation is selected.";
      select.addEventListener("change", () => { invalidateDraft(); });
      note.addEventListener("input", () => { invalidateDraft(); });
      selectLabel.append(select);
      noteLabel.append(note);
      card.append(selectLabel, noteLabel);
      if (dimensionId === "source_comparison") {
        const boundary = element("p", "visual-decision-boundary");
        boundary.dataset.role = "source-comparison-boundary";
        card.append(boundary);
      }
      target.append(card);
      const dimensionOption = element("option", "", label);
      dimensionOption.value = dimensionId;
      annotationDimension.append(dimensionOption);
    }
  }

  function syncVisualDecisionAvailability() {
    let effectiveComparison = false;
    try {
      effectiveComparison = comparisonIsEffectivelyVisible();
    } catch {
      effectiveComparison = false;
    }
    const baseAvailable = primaryArtifact !== null && previewControlsValid;
    for (const card of byId("visual-decision-grid").querySelectorAll("[data-visual-dimension-id]")) {
      const select = card.querySelector('[data-role="visual-observation"]');
      const note = card.querySelector('[data-role="visual-decision-note"]');
      const available = baseAvailable && (
        card.dataset.visualDimensionId !== "source_comparison" || effectiveComparison
      );
      if (!available) {
        select.value = "not_assessed";
        note.value = "";
      }
      select.disabled = !available;
      note.disabled = !available;
    }
    byId("add-visual-annotation").disabled = !baseAvailable;
    byId("build-visual-draft").disabled = !baseAvailable;
    const boundary = byId("visual-decision-grid").querySelector('[data-role="source-comparison-boundary"]');
    if (!boundary) return;
    if (!baseAvailable) {
      boundary.textContent = primaryArtifact
        ? "Not assessable while preview correction or bounds are invalid."
        : "Not assessable until a primary generated crop is loaded.";
    } else if (!comparisonArtifact) {
      boundary.textContent = "Not assessable until a compatible second crop is loaded.";
    } else if (comparisonArtifact.points.length === 0) {
      boundary.textContent = "Not assessable because the comparison crop contains no accepted points.";
    } else if (!byId("comparison-visible").checked) {
      boundary.textContent = "Not assessable while the comparison overlay is hidden.";
    } else if (currentOpacity() < minimumEffectiveComparisonOpacity) {
      boundary.textContent = "Not assessable below 5% comparison opacity.";
    } else {
      boundary.textContent = "A compatible non-empty second crop is visibly overlaid. Assess only this exact view.";
    }
  }

  function renderAnnotations() {
    const target = byId("visual-annotation-list");
    target.replaceChildren();
    annotations.forEach((annotation, index) => {
      const item = element("li");
      const copy = element("div");
      const label = dimensions.find((entry) => entry[0] === annotation.dimensionId)?.[1] || annotation.dimensionId;
      copy.append(
        element("strong", "", (index + 1) + " · " + label),
        element("p", "", annotation.note + " Preview scale " + annotation.previewCorrection.scaleMultiplier + "×; bounds " + annotation.boundsM.minimum.join(", ") + " → " + annotation.boundsM.maximum.join(", ") + ".")
      );
      const remove = element("button", "button button-secondary", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove visual annotation " + (index + 1));
      remove.addEventListener("click", () => {
        annotations = annotations.filter((_, currentIndex) => currentIndex !== index);
        invalidateDraft();
        renderAnnotations();
      });
      item.append(copy, remove);
      target.append(item);
    });
  }

  byId("add-visual-annotation").addEventListener("click", () => {
    const target = byId("visual-annotation-error");
    clearError(target);
    try {
      if (!primaryArtifact) fail("Open a validated generated crop before adding an annotation.");
      if (annotations.length >= maximumAnnotations) fail("The local draft is limited to 100 preview annotations.");
      const note = byId("visual-annotation-note").value.trim();
      if (note.length < 12 || note.length > 1000) fail("A preview annotation needs a 12 to 1000 character note.");
      annotations = [...annotations, {
        dimensionId: byId("visual-annotation-dimension").value,
        note,
        boundsM: currentBounds(),
        previewCorrection: currentCorrection()
      }];
      byId("visual-annotation-note").value = "";
      invalidateDraft();
      renderAnnotations();
    } catch (error) {
      showError(target, error instanceof Error ? error.message : "The preview annotation is invalid.");
    }
  });

  function currentView() {
    const canvasAspectRatio = requireNumber(
      canvas.clientWidth / canvas.clientHeight,
      "The preview canvas aspect ratio",
      0.1,
      10
    );
    return {
      projection: "orthographic_preview",
      yawDegrees: Number(requireNumber(normalizeYawDegrees(camera.yawDegrees), "The preview yaw", -180, 180).toFixed(6)),
      pitchDegrees: Number(requireNumber(camera.pitchDegrees, "The preview pitch", -89, 89).toFixed(6)),
      zoom: Number(requireNumber(camera.zoom, "The preview zoom", 0.01, 1000).toFixed(6)),
      targetM: camera.targetM.map((value) => Number(value.toFixed(9))),
      canvasAspectRatio: Number(canvasAspectRatio.toFixed(6)),
      comparisonVisible: comparisonIsEffectivelyVisible(),
      comparisonOpacity: currentOpacity(),
      previewBoundsM: currentBounds(),
      previewCorrection: currentCorrection()
    };
  }

  function currentDecisions() {
    const decisions = [];
    for (const card of byId("visual-decision-grid").querySelectorAll("[data-visual-dimension-id]")) {
      const observation = card.querySelector('[data-role="visual-observation"]').value;
      const note = card.querySelector('[data-role="visual-decision-note"]').value.trim();
      if (
        card.dataset.visualDimensionId === "source_comparison" &&
        observation !== "not_assessed" &&
        !comparisonIsEffectivelyVisible()
      ) {
        fail("Source comparison must remain not assessed unless a compatible non-empty comparison crop is effectively visible.");
      }
      if (observation !== "not_assessed" && note.length < 12) fail("Every assessed visual decision needs a 12 to 1000 character note.");
      if (note.length > 1000 || (note.length > 0 && note.length < 12)) fail("Visual decision notes must be empty or contain 12 to 1000 characters.");
      decisions.push({ dimensionId: card.dataset.visualDimensionId, observation, note });
    }
    if (decisions.length !== dimensions.length) fail("All seven visual dimensions must have an explicit decision.");
    return decisions;
  }

  function snapshotVisualDraftInput() {
    if (!primaryArtifact) fail("Open a validated generated crop before building a visual draft.");
    const reviewedBy = byId("visual-reviewed-by").value.trim();
    if (reviewedBy.length < 2 || reviewedBy.length > 160) fail("The visual reviewer name must contain 2 to 160 characters.");
    const view = currentView();
    const artifactDigests = [primaryArtifact.artifactSha256];
    if (comparisonArtifact) artifactDigests.push(comparisonArtifact.artifactSha256);
    return {
      revision: reviewStateRevision,
      primaryArtifact,
      comparisonArtifact,
      reviewedAt: new Date().toISOString(),
      reviewedBy,
      view,
      artifactDigests,
      decisions: currentDecisions(),
      annotations: annotations.map((annotation) => ({
        dimensionId: annotation.dimensionId,
        note: annotation.note,
        boundsM: {
          minimum: [...annotation.boundsM.minimum],
          maximum: [...annotation.boundsM.maximum]
        },
        previewCorrection: {
          translationM: [...annotation.previewCorrection.translationM],
          rotationDegrees: [...annotation.previewCorrection.rotationDegrees],
          scaleMultiplier: annotation.previewCorrection.scaleMultiplier
        }
      }))
    };
  }

  function requireCurrentDraftRequest(snapshot, submitEpoch) {
    if (snapshot.revision !== reviewStateRevision || submitEpoch !== draftSubmitEpoch) {
      fail("The visual review changed while its digest was being built. Build a fresh draft from the current view.");
    }
  }

  async function compileVisualDraft(submitEpoch) {
    const snapshot = snapshotVisualDraftInput();
    const viewSha256 = await sha256(viewDigestDomain, snapshot.view, "\n");
    requireCurrentDraftRequest(snapshot, submitEpoch);
    const decisions = snapshot.decisions.map((decision) => ({
      ...decision,
      artifactDigests: [...snapshot.artifactDigests],
      viewSha256
    }));
    const boundAnnotations = snapshot.annotations.map((annotation, index) => ({
      annotationId: "annotation-" + String(index + 1).padStart(3, "0"),
      ...annotation,
      artifactDigests: [...snapshot.artifactDigests],
      viewSha256
    }));
    const payload = {
      schemaVersion: visualDraftSchema,
      meaning: "local_visual_inspection_draft_only",
      authority: "none",
      subject: {
        primaryArtifactSha256: snapshot.primaryArtifact.artifactSha256,
        comparisonArtifactSha256: snapshot.comparisonArtifact ? snapshot.comparisonArtifact.artifactSha256 : null,
        sourceSha256: snapshot.primaryArtifact.source.sha256,
        sourceFactsArtifactSha256: snapshot.primaryArtifact.sourceFactsArtifactSha256,
        frame: "e57_root",
        units: "metre",
        axes: "right_handed_z_up",
        metadataReviewDraftSha256: null
      },
      reviewedAt: snapshot.reviewedAt,
      reviewedBy: snapshot.reviewedBy,
      inspectionBoundary: {
        ...inspectionBoundary,
        primaryPointCount: snapshot.primaryArtifact.points.length,
        comparisonPointCount: snapshot.comparisonArtifact ? snapshot.comparisonArtifact.points.length : null
      },
      view: snapshot.view,
      viewSha256,
      decisions,
      annotations: boundAnnotations,
      disposition: "preview_observations_only",
      releaseEligibility: "blocked",
      capabilities: draftCapabilities
    };
    const reviewDraftSha256 = await sha256(draftDigestDomain, payload, "\n");
    requireCurrentDraftRequest(snapshot, submitEpoch);
    return { ...payload, reviewDraftSha256 };
  }

  byId("visual-observation-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = byId("visual-draft-error");
    clearError(target);
    invalidateDraft();
    const submitEpoch = ++draftSubmitEpoch;
    try {
      visualDraft = await compileVisualDraft(submitEpoch);
      if (submitEpoch !== draftSubmitEpoch) return;
      byId("visual-draft-sha").textContent = visualDraft.reviewDraftSha256;
      byId("visual-draft-result").hidden = false;
      byId("visual-draft-result").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      if (submitEpoch !== draftSubmitEpoch) return;
      showError(target, error instanceof Error ? error.message : "The local visual inspection draft could not be built safely.");
    }
  });

  byId("download-visual-draft").addEventListener("click", () => {
    if (!visualDraft) return;
    const blob = new Blob([JSON.stringify(visualDraft, null, 2) + "\n"], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = element("a");
    anchor.href = objectUrl;
    anchor.download = "foundry-e57-local-visual-inspection-draft-v0.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  });

  renderDecisionControls();
  syncVisualDecisionAvailability();
  renderAnnotations();
  syncMaskSelectionFields();
  renderMaskRules();
  syncMaskAvailability();
})();`;
