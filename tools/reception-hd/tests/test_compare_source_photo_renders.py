from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import math
import os
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "compare_source_photo_renders.py"
SPEC = importlib.util.spec_from_file_location("compare_source_photo_renders", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

IMAGE_SIZE = 96
TEST_RUNNER_BYTES = b"generated-reviewed-capture-runner-v1"
TEST_RUNNER_SHA256 = hashlib.sha256(TEST_RUNNER_BYTES).hexdigest()
CAPTURE_WEB_ORIGIN = "http://127.0.0.1:4173"
CAPTURE_ASSET_ORIGINS = {
    "quality": "http://127.0.0.1:4175",
    "mobile": "http://127.0.0.1:4174",
}
MODULE.TRUSTED_HELDOUT_CAPTURE_RUNNER_SHA256 = frozenset({TEST_RUNNER_SHA256})
IDENTITY_CAMERA_TO_WORLD = [
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
    0.0,
    0.0,
    0.0,
    0.0,
    1.0,
]
HERO_FEATURES = tuple(sorted(MODULE.HERO_FEATURES))
LINEAGE_FIELDS = (
    "usedInReconstruction",
    "usedInMapping",
    "usedInBundleAdjustment",
    "usedInTraining",
    "usedInAppearanceFitting",
    "usedInPoseRefinement",
    "usedInThresholdSelection",
    "candidateImagesViewedBeforeMaskFreeze",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def file_ref(path: Path) -> dict[str, str]:
    return {"path": path.name, "sha256": sha256(path)}


def identity_file_ref(path: Path) -> dict[str, object]:
    return {"path": path.name, "sizeBytes": path.stat().st_size, "sha256": sha256(path)}


def component_digest(domain: bytes, value: object) -> str:
    return hashlib.sha256(domain + MODULE._canonical_json_bytes(value)).hexdigest()


def capture_asset_bytes(candidate_id: str) -> bytes:
    return f"generated-{candidate_id}-capture-asset".encode()


def capture_asset_set_digest(candidate_id: str) -> str:
    content = capture_asset_bytes(candidate_id)
    identity = [{
        "requestedPath": f"/{candidate_id}.splat",
        "digest": hashlib.sha256(content).hexdigest(),
        "sizeBytes": len(content),
    }]
    payload = json.dumps(identity, ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def room_pattern(seed: int) -> np.ndarray:
    y, x = np.mgrid[0:IMAGE_SIZE, 0:IMAGE_SIZE]
    base = ((x * (seed + 3) + y * (seed + 5)) % 180 + 30).astype(np.uint8)
    rgb = np.stack((base, np.roll(base, seed + 1, axis=0), np.roll(base, seed + 2, axis=1)), axis=2)
    rgb[14:22, 10:86] = (245, 235, 220)
    rgb[30:82, 18:24] = (35, 45, 55)
    rgb[48:55, 30:90] = (210, 90, 50)
    return rgb


def shifted(image: np.ndarray, pixels: int = 3) -> np.ndarray:
    result = np.roll(image, pixels, axis=1)
    result[:, :pixels] = 0
    return result


def save_rgb(path: Path, pixels: np.ndarray) -> None:
    Image.fromarray(pixels, mode="RGB").save(path)


def save_mask(path: Path, *, left: int, right: int) -> None:
    mask = np.zeros((IMAGE_SIZE, IMAGE_SIZE), dtype=np.uint8)
    mask[12:84, left:right] = 255
    Image.fromarray(mask, mode="L").save(path)


def camera_projection(near: float, far: float, fx: float, fy: float, cx: float, cy: float) -> list[float]:
    return [
        2.0 * fx / IMAGE_SIZE, 0.0, 1.0 - 2.0 * cx / IMAGE_SIZE, 0.0,
        0.0, 2.0 * fy / IMAGE_SIZE, 2.0 * cy / IMAGE_SIZE - 1.0, 0.0,
        0.0, 0.0, -(far + near) / (far - near), -(2.0 * far * near) / (far - near),
        0.0, 0.0, -1.0, 0.0,
    ]


def camera_contract(receipt: Path, validation: Path, index: int) -> dict[str, object]:
    near = 0.1
    far = 120.0
    fx = 82.0
    fy = 82.0
    cx = 47.5
    cy = 47.5
    position_x = index * 0.5
    camera_to_world = list(IDENTITY_CAMERA_TO_WORLD)
    camera_to_world[3] = position_x
    world_to_camera = list(IDENTITY_CAMERA_TO_WORLD)
    world_to_camera[3] = -position_x
    return {
        "projectionModel": "rectified_pinhole",
        "imageWidth": IMAGE_SIZE,
        "imageHeight": IMAGE_SIZE,
        "fxPixels": fx,
        "fyPixels": fy,
        "cxPixels": cx,
        "cyPixels": cy,
        "skewPixels": 0.0,
        "pixelCenterConvention": "pixel_centres_at_half_integers",
        "distortionModel": "none_after_rectification",
        "distortionCoefficients": [],
        "coordinateFrame": "reception-room-test-frame-v1",
        "poseConvention": "camera_to_world_row_major",
        "handedness": "right",
        "worldAxes": "x_right_y_up_z_back",
        "cameraToWorld": camera_to_world,
        "worldToCamera": world_to_camera,
        "projectionMatrix": camera_projection(near, far, fx, fy, cx, cy),
        "positionMetres": [position_x, 0.0, 0.0],
        "targetMetres": [position_x, 0.0, -1.0],
        "up": [0.0, 1.0, 0.0],
        "verticalFovDegrees": math.degrees(2.0 * math.atan(IMAGE_SIZE / (2.0 * fy))),
        "nearMetres": near,
        "farMetres": far,
        "units": "metres",
        "viewport": {"cssWidth": IMAGE_SIZE, "cssHeight": IMAGE_SIZE, "devicePixelRatio": 1.0},
        "crop": {"xPixels": 0, "yPixels": 0, "widthPixels": IMAGE_SIZE, "heightPixels": IMAGE_SIZE},
        "orientation": "pixels_already_upright",
        "cropResizeHistory": "none_after_rectification",
        "rectificationReceipt": file_ref(receipt),
        "cameraValidation": file_ref(validation),
    }


def lineage(value: str) -> dict[str, str]:
    return {field: value for field in LINEAGE_FIELDS}


def comparison_block(*, heldout: bool, plan: Path | None) -> dict[str, object]:
    return {
        "metricIds": list(MODULE.METRIC_IDS),
        "minimumPracticalEffect": {
            "maskedMultiscaleEdgeChamfer": 0.001 if heldout else None,
            "maskedGradientOrientationSimilarity": 0.001 if heldout else None,
            "maskedLinearRgbRmse": 0.001 if heldout else None,
            "maskedSrgbPsnrDb": 0.01 if heldout else None,
            "maskedSrgbSsim": 0.001 if heldout else None,
            "maskedSrgbMae": 0.001 if heldout else None,
        },
        "sharedColorTransform": None,
        "fullFrameIsDiagnosticOnly": True,
        "humanReview": {
            "required": True,
            "blindCandidateLabels": True,
            "planReceipt": file_ref(plan) if plan is not None else None,
        },
    }


def make_reference_files(
    root: Path,
    prefix: str,
    reference: np.ndarray,
    heldout: bool,
    view_id: str,
    camera_digest: str,
    room_state_digest: str,
) -> tuple[Path, list[dict[str, str]], list[dict[str, str]], Path]:
    source_path = root / f"{prefix}-source.png"
    save_rgb(source_path, reference)
    repeats: list[dict[str, str]] = []
    if heldout:
        for repeat_index in range(2):
            repeat_path = root / f"{prefix}-source-repeat-{repeat_index + 1}.png"
            repeated = reference.copy()
            repeated[2 + repeat_index, 2 + repeat_index] = (20 + repeat_index, 30, 40)
            save_rgb(repeat_path, repeated)
            repeats.append(file_ref(repeat_path))
    development_receipt = root / f"{prefix}-development-recipe.json"
    development_receipt.write_text('{"development":"generated-test-lossless"}\n', encoding="utf-8")
    image_refs = [file_ref(source_path), *repeats]
    acquisitions: list[dict[str, str]] = []
    for ordinal, image_ref in enumerate(image_refs, start=1):
        receipt = root / f"{prefix}-acquisition-{ordinal}.json"
        payload = {
            "schemaVersion": MODULE.REFERENCE_ACQUISITION_SCHEMA_VERSION,
            "viewId": view_id,
            "cameraBindingDigest": camera_digest,
            "roomStateDigest": room_state_digest,
            "developmentRecipeDigest": sha256(development_receipt),
            "captureId": f"{prefix}-physical-capture-{ordinal}",
            "captureSessionId": f"{prefix}-physical-session",
            "sourceIdentityId": f"{prefix}-raw-source-{ordinal}",
            "rawSourceSha256": hashlib.sha256(f"{prefix}-raw-{ordinal}".encode()).hexdigest(),
            "developedImageSha256": image_ref["sha256"],
            "deviceIdentityDigest": hashlib.sha256(f"{prefix}-test-camera".encode()).hexdigest(),
            "capturedAtUtc": f"2026-07-22T11:00:0{ordinal}Z",
            "acquisitionOrdinal": ordinal,
            "physicalAcquisition": True,
            "generatedPixels": False,
            "candidateDataUsed": False if heldout else True,
        }
        receipt.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        acquisitions.append(file_ref(receipt))
    return source_path, repeats, acquisitions, development_receipt


def make_camera(root: Path, prefix: str, index: int, heldout: bool) -> dict[str, object]:
    rectification = root / f"{prefix}-rectification.json"
    rectification.write_text('{"method":"generated-test-pinhole"}\n', encoding="utf-8")
    validation = root / f"{prefix}-camera-validation.json"
    validation.write_text("{}\n", encoding="utf-8")
    camera = camera_contract(rectification, validation, index)
    payload = {
        "schemaVersion": MODULE.CAMERA_VALIDATION_SCHEMA_VERSION,
        "viewId": prefix,
        "cameraBindingDigest": MODULE._camera_binding_digest(camera),
        "method": "independent_natural_feature_reprojection" if heldout else "declared_unverified",
        "controlSource": "captured_static_architecture" if heldout else "unknown",
        "fitControlCount": 12 if heldout else 0,
        "blindControlCount": 6 if heldout else 0,
        "medianReprojectionErrorPixels": 0.5 if heldout else None,
        "p95ReprojectionErrorPixels": 1.0 if heldout else None,
        "maximumReprojectionErrorPixels": 1.5 if heldout else None,
        "candidateDataUsed": False if heldout else "unknown",
        "targetAssistance": "excluded" if heldout else "unknown",
    }
    validation.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    camera["cameraValidation"] = file_ref(validation)
    return camera


def make_regions(root: Path, prefix: str, index: int) -> list[dict[str, object]]:
    hero_mask = root / f"{prefix}-hero-mask.png"
    context_mask = root / f"{prefix}-context-mask.png"
    save_mask(hero_mask, left=8, right=47)
    save_mask(context_mask, left=49, right=88)
    feature = HERO_FEATURES[index % len(HERO_FEATURES)]
    safe_region = {
        "sharedFovVerified": True,
        "roomStateStatus": "unchanged",
        "targetAssistance": "excluded",
        "contentStatus": "static_architecture",
    }
    return [
        {"regionId": f"{prefix}-hero", "kind": "hero", "feature": feature,
         "mask": file_ref(hero_mask), **safe_region},
        {"regionId": f"{prefix}-context", "kind": "non_hero", "feature": "context",
         "mask": file_ref(context_mask), **safe_region},
    ]


def make_view(root: Path, index: int, *, heldout: bool) -> dict[str, object]:
    prefix = f"view-{index:02d}"
    reference = room_pattern(index + 1)
    room_state = hashlib.sha256(("one-heldout-room-state" if heldout else f"room-state-{index}").encode()).hexdigest()
    camera = make_camera(root, prefix, index, heldout)
    source_path, repeats, acquisitions, development_receipt = make_reference_files(
        root, prefix, reference, heldout, prefix,
        MODULE._camera_binding_digest(camera), room_state
    )
    return {
        "viewId": prefix,
        "roomStateDigest": room_state,
        "camera": camera,
        "reference": {
            "image": file_ref(source_path),
            "repeatImages": repeats,
            "role": "heldout_physical" if heldout else "source_view",
            "lineage": lineage("no" if heldout else "yes"),
            "generatedPixels": False,
            "candidateDerived": False,
            "acquisitionReceipts": acquisitions,
            "developmentRecipeReceipt": file_ref(development_receipt),
        },
        "regions": make_regions(root, prefix, index),
    }


def candidate_fixture(root: Path, candidate_id: str, heldout: bool) -> tuple[dict[str, object], dict[str, object]]:
    (root / f"{candidate_id}-capture-asset.splat").write_bytes(capture_asset_bytes(candidate_id))
    inventory_path = root / f"{candidate_id}-dataset-inventory.json"
    lineage = []
    if heldout:
        lineage.append({
            "developedImageSha256": hashlib.sha256(f"{candidate_id}-developed".encode()).hexdigest(),
            "rawSourceSha256": hashlib.sha256(f"{candidate_id}-raw".encode()).hexdigest(),
            "sourceIdentityId": f"{candidate_id}-independent-source",
            "uses": list(MODULE.CANDIDATE_DATA_USES),
        })
    inventory = {
        "schemaVersion": MODULE.DATASET_INVENTORY_SCHEMA_VERSION,
        "candidateId": candidate_id,
        "completeness": "complete" if heldout else "unknown",
        "usedImageLineage": lineage,
        "coveredUses": list(MODULE.CANDIDATE_DATA_USES) if heldout else [],
    }
    inventory_path.write_text(json.dumps(inventory) + "\n", encoding="utf-8")
    inventory_ref = {"candidateId": candidate_id, "receipt": file_ref(inventory_path)}
    binding = {
        "candidateId": candidate_id,
        "assetSetSha256": capture_asset_set_digest(candidate_id),
        "profileId": "locked-test-profile",
        "expectedSplatCount": 1000 if candidate_id == "quality" else 900,
    }
    return inventory_ref, binding


def renderer_fixture() -> tuple[dict[str, str], str]:
    runtime_environment = {
        "mobileOrigin": CAPTURE_ASSET_ORIGINS["mobile"],
        "qualityOrigin": CAPTURE_ASSET_ORIGINS["quality"],
    }
    renderer_components = {
        "runtimeBuildDigest": hashlib.sha256(b"shared-runtime-build").hexdigest(),
        "runtimeEnvironmentDigest": component_digest(
            MODULE.RUNTIME_ENVIRONMENT_DIGEST_DOMAIN, runtime_environment
        ),
        "profileDigest": hashlib.sha256(b"shared-profile").hexdigest(),
        "toneMapDigest": hashlib.sha256(b"shared-tone-map").hexdigest(),
        "exposureDigest": hashlib.sha256(b"shared-exposure").hexdigest(),
        "colourSpaceDigest": hashlib.sha256(b"shared-srgb").hexdigest(),
    }
    renderer_digest = hashlib.sha256(
        MODULE.RENDERER_BINDING_DIGEST_DOMAIN + MODULE._canonical_json_bytes(renderer_components)
    ).hexdigest()
    return renderer_components, renderer_digest


def capture_approval_fixture(root: Path, heldout: bool, renderer_digest: str) -> dict[str, object] | None:
    if not heldout:
        return None
    approval = root / "capture-adapter-approval.json"
    approval.write_text(json.dumps({
            "schemaVersion": MODULE.CAPTURE_ADAPTER_APPROVAL_SCHEMA_VERSION,
            "runnerSha256": TEST_RUNNER_SHA256,
            "rendererBindingDigest": renderer_digest,
            "independentReview": True,
            "rendererOwnedTelemetry": True,
            "assetBytesBoundToFrame": True,
            "cameraStateBoundToFrame": True,
            "rendererStateBoundToFrame": True,
            "roomStateBoundToFrame": True,
            "presentedFrameIdBoundToFrame": True,
            "approvedForHeldoutPhysicalComparison": True,
    }) + "\n", encoding="utf-8")
    return file_ref(approval)


def write_draft(root: Path, *, heldout: bool) -> Path:
    plan = root / "human-review-plan.md"
    plan.write_text("Blind review plan for generated fixtures.\n", encoding="utf-8")
    rights = root / "internal-comparison-rights.json"
    rights.write_text('{"internalComparisonApproved":true}\n', encoding="utf-8")
    views = [make_view(root, index, heldout=heldout) for index in range(6 if heldout else 1)]
    fixtures = [candidate_fixture(root, item, heldout) for item in ("quality", "mobile")]
    inventories, candidate_bindings = map(list, zip(*fixtures, strict=True))
    renderer_components, renderer_digest = renderer_fixture()
    frozen_runner = root / "frozen-capture-runner.mjs"
    frozen_runner.write_bytes(TEST_RUNNER_BYTES)
    payload = {
        "schemaVersion": MODULE.DRAFT_SCHEMA_VERSION,
        "authority": "none",
        "comparisonId": "rr-heldout-test" if heldout else "rr-source-test",
        "roomId": "reception-room",
        "purpose": "heldout_physical_comparison" if heldout else "source_view_diagnostic",
        "candidateIds": ["quality", "mobile"],
        "candidateBindings": candidate_bindings,
        "rights": {
            "internalComparisonApproved": True,
            "publicationApproved": False,
            "trainingApproved": False,
            "receipt": file_ref(rights),
        },
        "candidateInventories": inventories,
        "rendererBinding": {"digest": renderer_digest, **renderer_components},
        "captureBinding": {
            "evidenceClass": "pinned_renderer_owned_telemetry" if heldout else "diagnostic_renderer_owned_telemetry",
            "runnerImplementation": file_ref(frozen_runner),
            "independentApprovalReceipt": capture_approval_fixture(root, heldout, renderer_digest),
        },
        "comparison": comparison_block(heldout=heldout, plan=plan if heldout else None),
        "views": views,
    }
    path = root / "draft.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def capture_frame_evidence(
    protocol: dict[str, object], binding: dict[str, object], candidate_id: str,
    view: dict[str, object], capture_index: int, image: Path, asset_sha256: str,
) -> tuple[dict[str, object], str, str]:
    renderer = protocol["rendererBinding"]
    presented_frame_id = f"{candidate_id}-{view['viewId']}-presented-{capture_index}"
    session_id = hashlib.sha256(f"{candidate_id}-{view['viewId']}".encode()).hexdigest()[:32]
    frame_evidence = {
        "schemaVersion": MODULE.CAPTURE_ADAPTER_SCHEMA_VERSION,
        "protocolDigest": protocol["protocolDigest"],
        "challengeNonce": f"{candidate_id}-{view['viewId']}-challenge-{capture_index}",
        "documentSessionId": session_id,
        "renderSequence": capture_index + 1,
        "presentedFrameId": presented_frame_id,
        "candidateId": candidate_id,
        "viewId": view["viewId"],
        "assetSetSha256": asset_sha256,
        "assetReceipts": [{"testFixture": True}],
        "profileId": binding["profileId"],
        "loadedSourceCount": 1,
        "loadedSplatCount": binding["expectedSplatCount"],
        "rendererBinding": renderer,
        "camera": {"testFixture": True},
        "renderer": {"testFixture": True},
        "framebufferPixelSha256": sha256(image),
    }
    renderer_frame_digest = hashlib.sha256(
        MODULE.FRAME_DIGEST_DOMAIN + MODULE._canonical_json_bytes(frame_evidence)
    ).hexdigest()
    return frame_evidence, presented_frame_id, renderer_frame_digest


def capture_receipt(
    root: Path,
    protocol: dict[str, object],
    candidate_id: str,
    view: dict[str, object],
    capture_index: int,
    image: Path,
    asset_sha256: str,
    renderer_digest: str,
    provenance: dict[str, object],
) -> Path:
    binding = next(item for item in protocol["candidateBindings"] if item["candidateId"] == candidate_id)
    renderer = protocol["rendererBinding"]
    frame_evidence, presented_frame_id, renderer_frame_digest = capture_frame_evidence(
        protocol, binding, candidate_id, view, capture_index, image, asset_sha256,
    )
    payload = {
        "schemaVersion": MODULE.CAPTURE_RECEIPT_SCHEMA_VERSION,
        "authority": "none",
        "protocolDigest": protocol["protocolDigest"],
        "candidateId": candidate_id,
        "viewId": view["viewId"],
        "captureId": f"{candidate_id}-{view['viewId']}-capture-{capture_index}",
        "reloadId": f"{candidate_id}-{view['viewId']}-reload-{capture_index}",
        "cameraDigest": view["cameraDigest"],
        "roomStateDigest": view["roomStateDigest"],
        "assetSha256": asset_sha256,
        "profileId": binding["profileId"],
        "expectedSplatCount": binding["expectedSplatCount"],
        "rendererConfigDigest": renderer_digest,
        "runtimeBuildDigest": renderer["runtimeBuildDigest"],
        "runtimeEnvironmentDigest": renderer["runtimeEnvironmentDigest"],
        "profileDigest": renderer["profileDigest"],
        "toneMapDigest": renderer["toneMapDigest"],
        "exposureDigest": renderer["exposureDigest"],
        "colourSpaceDigest": renderer["colourSpaceDigest"],
        "captureEvidenceClass": protocol["captureBinding"]["evidenceClass"],
        "capturePlanSha256": provenance["capturePlan"]["sha256"],
        "capturePlanSizeBytes": provenance["capturePlan"]["sizeBytes"],
        "webOrigin": provenance["webOrigin"],
        "servedPageManifestDigest": provenance["servedPageManifestDigest"],
        "captureToolchainDigest": provenance["captureToolchainDigest"],
        "presentedFrameId": presented_frame_id,
        "rendererFrameDigest": renderer_frame_digest,
        "frameEvidence": frame_evidence,
        "imageSha256": sha256(image),
        "captureOrdinal": capture_index + 1,
        "renderedFrameCounter": 100 + capture_index,
        "capturedAtUtc": f"2026-07-22T12:00:0{capture_index}Z",
        "captureRunnerSha256": TEST_RUNNER_SHA256,
    }
    path = root / f"{candidate_id}-{view['viewId']}-receipt-{capture_index}.json"
    path.write_text(json.dumps(payload, sort_keys=True) + "\n", encoding="utf-8")
    return path


def capture_plan_candidate(
    root: Path, protocol: dict[str, object], candidate_id: str
) -> dict[str, object]:
    binding = next(item for item in protocol["candidateBindings"] if item["candidateId"] == candidate_id)
    asset_path = (root / f"{candidate_id}-capture-asset.splat").resolve()
    asset = {
        "requestPath": f"/{candidate_id}.splat",
        "localPath": str(asset_path),
        "sha256": sha256(asset_path),
        "sizeBytes": asset_path.stat().st_size,
    }
    return {
        "candidateId": candidate_id,
        "assetSetSha256": binding["assetSetSha256"],
        "profileId": binding["profileId"],
        "expectedSplatCount": binding["expectedSplatCount"],
        "assetOrigin": CAPTURE_ASSET_ORIGINS[candidate_id],
        "assets": [asset],
    }


def write_capture_plan(root: Path, protocol: dict[str, object]) -> Path:
    payload = {
        "schemaVersion": MODULE.CAPTURE_PLAN_SCHEMA_VERSION,
        "authority": "none",
        "protocolDigest": protocol["protocolDigest"],
        "webOrigin": CAPTURE_WEB_ORIGIN,
        "candidates": [capture_plan_candidate(root, protocol, item) for item in protocol["candidateIds"]],
    }
    path = root / "capture-plan.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def capture_toolchain_fixture() -> dict[str, object]:
    packages = []
    for index, name in enumerate(("vite", "@vitejs/plugin-react", "@playwright/test", "playwright", "playwright-core")):
        packages.append({
            "name": name,
            "version": f"1.0.{index}",
            "fileCount": index + 1,
            "sizeBytes": 100 + index,
            "treeSha256": hashlib.sha256(f"{name}-tree".encode()).hexdigest(),
        })
    body = {
        "schemaVersion": MODULE.CAPTURE_TOOLCHAIN_SCHEMA_VERSION,
        "node": {
            "version": "v24.0.0",
            "platform": "generated-test",
            "architecture": "x64",
            "sizeBytes": 1_024,
            "sha256": hashlib.sha256(b"generated-node").hexdigest(),
        },
        "packages": packages,
        "chromium": {
            "fileCount": 3,
            "sizeBytes": 4_096,
            "treeSha256": hashlib.sha256(b"generated-chromium-tree").hexdigest(),
        },
    }
    return {**body, "digest": component_digest(MODULE.CAPTURE_TOOLCHAIN_DIGEST_DOMAIN, body)}


def served_page_entries(root: Path) -> list[dict[str, object]]:
    served_root = root / "served-page"
    (served_root / "assets").mkdir(parents=True)
    files = {
        "assets/app.js": b"globalThis.__generatedCaptureApp = true;\n",
        "favicon.svg": b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
        "index.html": b'<!doctype html><div id="root"></div>\n',
    }
    for relative, payload in files.items():
        (served_root / relative).write_bytes(payload)
    content_types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".svg": "image/svg+xml",
    }
    return [{
        "path": f"/{relative}",
        "sizeBytes": len(files[relative]),
        "sha256": hashlib.sha256(files[relative]).hexdigest(),
        "contentType": content_types[Path(relative).suffix],
    } for relative in sorted(files)]


def write_capture_provenance(root: Path, protocol: dict[str, object]) -> dict[str, object]:
    plan_path = write_capture_plan(root, protocol)
    toolchain = capture_toolchain_fixture()
    renderer = protocol["rendererBinding"]
    manifest_body = {
        "schemaVersion": MODULE.SERVED_PAGE_MANIFEST_SCHEMA_VERSION,
        "authority": "none",
        "webOrigin": CAPTURE_WEB_ORIGIN,
        "runtimeBuildDigest": renderer["runtimeBuildDigest"],
        "runtimeEnvironmentDigest": renderer["runtimeEnvironmentDigest"],
        "rendererBindingDigest": renderer["digest"],
        "retainedRoot": "served-page",
        "captureToolchain": toolchain,
        "entries": served_page_entries(root),
    }
    manifest = {
        **manifest_body,
        "digest": component_digest(MODULE.SERVED_PAGE_MANIFEST_DIGEST_DOMAIN, manifest_body),
    }
    manifest_path = root / "served-page-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {
        "capturePlan": identity_file_ref(plan_path),
        "webOrigin": CAPTURE_WEB_ORIGIN,
        "servedPageManifest": identity_file_ref(manifest_path),
        "servedPageManifestDigest": manifest["digest"],
        "captureToolchainDigest": toolchain["digest"],
    }


def write_run(root: Path, protocol: dict[str, object]) -> Path:
    runner_path = root / "capture-runner-copy.mjs"
    runner_path.write_bytes(TEST_RUNNER_BYTES)
    provenance = write_capture_provenance(root, protocol)
    candidates = []
    for candidate_id in protocol["candidateIds"]:
        binding = next(item for item in protocol["candidateBindings"] if item["candidateId"] == candidate_id)
        asset_sha256 = binding["assetSetSha256"]
        renderer_digest = protocol["rendererBinding"]["digest"]
        candidate_views = []
        for view_index, view in enumerate(protocol["views"]):
            with Image.open(Path(view["reference"]["image"]["resolvedPath"])) as source:
                source_pixels = np.asarray(source.convert("RGB"), dtype=np.uint8).copy()
            pixels = source_pixels if candidate_id == "quality" else shifted(source_pixels)
            captures = []
            for capture_index in range(3):
                image_path = root / f"{candidate_id}-{view['viewId']}-{capture_index}.png"
                save_rgb(image_path, pixels)
                receipt_path = capture_receipt(
                    root,
                    protocol,
                    candidate_id,
                    view,
                    capture_index,
                    image_path,
                    asset_sha256,
                    renderer_digest,
                    provenance,
                )
                captures.append({"image": file_ref(image_path), "receipt": file_ref(receipt_path)})
            candidate_views.append({"viewId": view["viewId"], "captures": captures})
        candidates.append(
            {
                "candidateId": candidate_id,
                "assetSha256": asset_sha256,
                "profileId": binding["profileId"],
                "expectedSplatCount": binding["expectedSplatCount"],
                "rendererConfigDigest": renderer_digest,
                "views": candidate_views,
            }
        )
    run = {
        "schemaVersion": MODULE.RUN_SCHEMA_VERSION,
        "authority": "none",
        "protocolDigest": protocol["protocolDigest"],
        "captureRunnerImplementation": file_ref(runner_path),
        **provenance,
        "candidates": candidates,
    }
    path = root / "run.json"
    path.write_text(json.dumps(run, indent=2) + "\n", encoding="utf-8")
    return path


def write_completed_review(
    root: Path,
    result: dict[str, object],
    board_path: Path,
    *,
    preference: str,
    materially_visible: str = "yes",
    calibrated: bool = True,
) -> Path:
    with Image.open(board_path) as board:
        board_width, board_height = board.size
    rows = []
    row_index = 0
    for view in result["views"]:
        for _region in view["regions"]:
            rows.append(
                {
                    "reviewRowId": MODULE._review_row_id(row_index),
                    "preference": preference,
                    "materiallyVisible": materially_visible,
                    "confidence": "high",
                    "artifactFlags": ["none"],
                    "notes": "Generated fixture review.",
                }
            )
            row_index += 1
    payload = {
        "schemaVersion": MODULE.REVIEW_INPUT_SCHEMA_VERSION,
        "authority": "human_observation_only",
        "resultDigest": result["resultDigest"],
        "protocolDigest": result["protocolDigest"],
        "boardSha256": sha256(board_path),
        "reviewerId": "generated-reviewer",
        "deviceModel": "generated-test-display",
        "displayWidthPixels": board_width,
        "displayHeightPixels": board_height,
        "displayCalibration": "calibrated" if calibrated else "unknown",
        "viewingDistanceCentimetres": 60.0,
        "zoomPercent": 100,
        "boardDisplayedAtNativePixels": True,
        "rows": rows,
    }
    path = root / "completed-review.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def assert_error(test: unittest.TestCase, code: str, callback: object) -> None:
    with test.assertRaises(MODULE.SourceComparisonError) as raised:
        callback()
    test.assertEqual(raised.exception.code, code)


def rewrite_identity_json(
    root: Path, run: dict[str, object], field: str, payload: dict[str, object]
) -> None:
    path = root / run[field]["path"]
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    run[field] = identity_file_ref(path)


def decision_views(untouched: str, normalized: str) -> list[dict[str, object]]:
    views = []
    for view_index in range(6):
        signals = {}
        for lane, winner in (("untouched", untouched), ("sharedNormalized", normalized)):
            signals[lane] = {
                metric: {"clearLeader": winner}
                for metric in MODULE.METRIC_IDS
            }
        context_signals = copy.deepcopy(signals)
        views.append({
            "viewId": f"view-{view_index:02d}",
            "regions": [
                {
                    "regionId": f"hero-{view_index:02d}",
                    "kind": "hero",
                    "feature": HERO_FEATURES[view_index % len(HERO_FEATURES)],
                    "signals": signals,
                },
                {
                    "regionId": f"context-{view_index:02d}",
                    "kind": "non_hero",
                    "feature": "context",
                    "signals": context_signals,
                },
            ],
        })
    return views


class SourcePhotoComparisonTests(unittest.TestCase):
    def test_source_view_run_is_useful_but_winner_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            run_path = write_run(root, protocol)

            result = MODULE.evaluate_run(
                root / "protocol.json",
                run_path,
                root / "result.json",
                root / "board.png",
                root / "review.md",
                root / "answer-key.json",
                root / "review-form.json",
            )

            self.assertEqual(result["decision"]["status"], "source_view_diagnostic_only")
            self.assertIsNone(result["decision"]["candidateDirectionalLead"])
            self.assertIsNone(result["decision"]["productWinner"])
            self.assertFalse(result["decision"]["promotionAuthorized"])
            self.assertTrue((root / "board.png").is_file())
            self.assertIn("cannot choose a product winner", (root / "review.md").read_text())
            form = json.loads((root / "review-form.json").read_text())
            self.assertTrue(all(row["preference"] == "not_assessable" for row in form["rows"]))
            receipt = MODULE.record_review(
                root / "result.json",
                root / "board.png",
                root / "answer-key.json",
                root / "review-form.json",
                root / "unreviewed-receipt.json",
            )
            self.assertEqual(receipt["status"], "review_recorded_source_diagnostic_only")
            self.assertIsNone(receipt["humanDirectionalObservation"])

    def test_heldout_run_can_report_only_a_non_promotional_directional_lead(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=True), root / "protocol.json")
            result = MODULE.evaluate_run(
                root / "protocol.json",
                write_run(root, protocol),
                root / "result.json",
                root / "board.png",
                root / "review.md",
                root / "answer-key.json",
            )

            self.assertEqual(result["decision"]["status"], "directional_lead_requires_human_review")
            self.assertEqual(result["decision"]["candidateDirectionalLead"], "quality")
            self.assertIsNone(result["decision"]["productWinner"])
            self.assertFalse(result["decision"]["isPhysicalApproval"])
            self.assertFalse(result["decision"]["isCommercialApproval"])

    def test_normalisation_rank_reversal_is_always_unstable(self) -> None:
        protocol = {
            "purpose": "heldout_physical_comparison",
            "candidateIds": ["quality", "mobile"],
            "comparison": {"sharedColorTransform": {"frozen": True}},
        }
        decision = MODULE._decision(protocol, decision_views("quality", "mobile"))
        self.assertEqual(decision["status"], "unstable_under_normalisation")
        self.assertIsNone(decision["candidateDirectionalLead"])
        self.assertIsNone(decision["productWinner"])

    def test_context_regions_can_veto_but_cannot_outvote_hero_features(self) -> None:
        protocol = {
            "purpose": "heldout_physical_comparison",
            "candidateIds": ["quality", "mobile"],
            "comparison": {"sharedColorTransform": None},
        }
        views = decision_views("mobile", "mobile")
        for view in views:
            for metric in MODULE.METRIC_IDS:
                view["regions"][1]["signals"]["untouched"][metric]["clearLeader"] = "quality"
        decision = MODULE._decision(protocol, views)
        self.assertEqual(decision["status"], "context_regression_veto")
        self.assertIsNone(decision["candidateDirectionalLead"])
        self.assertEqual(decision["laneEvidence"]["untouched"]["heroCandidate"], "mobile")

    def test_production_empty_allowlist_blocks_heldout_freeze(self) -> None:
        previous = MODULE.TRUSTED_HELDOUT_CAPTURE_RUNNER_SHA256
        MODULE.TRUSTED_HELDOUT_CAPTURE_RUNNER_SHA256 = frozenset()
        try:
            with tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                assert_error(
                    self,
                    "HELDOUT_CAPTURE_ADAPTER_NOT_ALLOWLISTED",
                    lambda: MODULE.freeze_protocol(write_draft(root, heldout=True), root / "protocol.json"),
                )
        finally:
            MODULE.TRUSTED_HELDOUT_CAPTURE_RUNNER_SHA256 = previous

    def test_freeze_rejects_missing_intrinsics_and_wrong_camera_semantics(self) -> None:
        mutations = (
            ("INVALID_CAMERA_KEYS", lambda payload: payload["views"][0]["camera"].pop("fxPixels")),
            ("UNSUPPORTED_CAMERA", lambda payload: payload["views"][0]["camera"].__setitem__("handedness", "left")),
            ("UNSUPPORTED_CAMERA", lambda payload: payload["views"][0]["camera"].__setitem__("cropResizeHistory", "cropped_after_render")),
        )
        for expected, mutate in mutations:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                draft = write_draft(root, heldout=False)
                payload = json.loads(draft.read_text())
                mutate(payload)
                draft.write_text(json.dumps(payload), encoding="utf-8")
                assert_error(self, expected, lambda: MODULE.freeze_protocol(draft, root / "protocol.json"))

    def test_heldout_role_rejects_source_leakage_and_unknown_lineage(self) -> None:
        for value in ("yes", "unknown"):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                draft = write_draft(root, heldout=True)
                payload = json.loads(draft.read_text())
                payload["views"][0]["reference"]["lineage"]["usedInTraining"] = value
                draft.write_text(json.dumps(payload), encoding="utf-8")
                assert_error(
                    self,
                    "HELDOUT_LINEAGE_NOT_CLEAN",
                    lambda: MODULE.freeze_protocol(draft, root / "protocol.json"),
                )

    def test_heldout_rejects_target_assistance_changed_state_and_full_frame_mask(self) -> None:
        mutations = (
            ("UNSAFE_REGION", lambda payload: payload["views"][0]["regions"][0].__setitem__("targetAssistance", "present")),
            ("UNSAFE_REGION", lambda payload: payload["views"][0]["regions"][0].__setitem__("roomStateStatus", "changed")),
        )
        for expected, mutate in mutations:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                draft = write_draft(root, heldout=True)
                payload = json.loads(draft.read_text())
                mutate(payload)
                draft.write_text(json.dumps(payload), encoding="utf-8")
                assert_error(self, expected, lambda: MODULE.freeze_protocol(draft, root / "protocol.json"))

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            draft = write_draft(root, heldout=True)
            payload = json.loads(draft.read_text())
            mask_path = root / payload["views"][0]["regions"][0]["mask"]["path"]
            Image.fromarray(np.full((IMAGE_SIZE, IMAGE_SIZE), 255, dtype=np.uint8), mode="L").save(mask_path)
            payload["views"][0]["regions"][0]["mask"] = file_ref(mask_path)
            draft.write_text(json.dumps(payload), encoding="utf-8")
            assert_error(self, "INVALID_MASK_COVERAGE", lambda: MODULE.freeze_protocol(draft, root / "protocol.json"))

    def test_heldout_requires_thresholds_repeats_feature_coverage_and_review_plan(self) -> None:
        mutations = (
            ("MISSING_PRACTICAL_THRESHOLD", lambda payload: payload["comparison"]["minimumPracticalEffect"].__setitem__("maskedMultiscaleEdgeChamfer", None)),
            ("HELDOUT_REFERENCE_REPEATS_REQUIRED", lambda payload: payload["views"][0]["reference"].__setitem__("repeatImages", [])),
            ("HELDOUT_VIEW_COVERAGE_INCOMPLETE", lambda payload: payload.__setitem__("views", payload["views"][:5])),
            ("HUMAN_REVIEW_PLAN_REQUIRED", lambda payload: payload["comparison"]["humanReview"].__setitem__("planReceipt", None)),
        )
        for expected, mutate in mutations:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                draft = write_draft(root, heldout=True)
                payload = json.loads(draft.read_text())
                mutate(payload)
                draft.write_text(json.dumps(payload), encoding="utf-8")
                assert_error(self, expected, lambda: MODULE.freeze_protocol(draft, root / "protocol.json"))

    def test_evaluate_rejects_wrong_camera_protocol_room_state_and_cached_repeats(self) -> None:
        mutations = (
            ("CAPTURE_PROTOCOL_MISMATCH", lambda receipt: receipt.__setitem__("protocolDigest", "0" * 64)),
            ("CAPTURE_CAMERA_MISMATCH", lambda receipt: receipt.__setitem__("cameraDigest", "0" * 64)),
            ("CAPTURE_ROOM_STATE_MISMATCH", lambda receipt: receipt.__setitem__("roomStateDigest", "0" * 64)),
            ("CAPTURE_RELOAD_ID_REUSED", lambda receipt: receipt.__setitem__("reloadId", "quality-view-00-reload-0")),
            ("CAPTURE_FRAME_COUNTER_NOT_FRESH", lambda receipt: receipt.__setitem__("renderedFrameCounter", 100)),
            ("CAPTURE_TIMESTAMPS_NOT_INCREASING", lambda receipt: receipt.__setitem__("capturedAtUtc", "2026-07-22T12:00:00Z")),
            ("FRAME_EVIDENCE_DIGEST_MISMATCH", lambda receipt: receipt["frameEvidence"].__setitem__("renderSequence", 99)),
        )
        for expected, mutate in mutations:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
                run_path = write_run(root, protocol)
                run = json.loads(run_path.read_text())
                target_ref = run["candidates"][0]["views"][0]["captures"][1]["receipt"]
                receipt_path = root / target_ref["path"]
                receipt = json.loads(receipt_path.read_text())
                mutate(receipt)
                receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
                target_ref["sha256"] = sha256(receipt_path)
                run_path.write_text(json.dumps(run), encoding="utf-8")
                assert_error(
                    self,
                    expected,
                    lambda: MODULE.evaluate_run(
                        root / "protocol.json", run_path, root / "result.json", None, None
                    ),
                )

    def test_run_v2_rejects_every_omitted_provenance_field(self) -> None:
        fields = (
            "capturePlan", "webOrigin", "servedPageManifest",
            "servedPageManifestDigest", "captureToolchainDigest",
        )
        for field in fields:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
                run_path = write_run(root, protocol)
                run = json.loads(run_path.read_text())
                run.pop(field)
                run_path.write_text(json.dumps(run), encoding="utf-8")
                assert_error(
                    self, "INVALID_RUN_KEYS",
                    lambda: MODULE.evaluate_run(root / "protocol.json", run_path, root / "result.json"),
                )

    def test_receipt_v3_rejects_omitted_and_mismatched_run_provenance(self) -> None:
        mutations = (
            ("capturePlanSha256", "0" * 64, "CAPTURE_PLAN_RECEIPT_MISMATCH"),
            ("capturePlanSizeBytes", 1, "CAPTURE_PLAN_RECEIPT_MISMATCH"),
            ("webOrigin", "http://127.0.0.1:4999", "CAPTURE_WEB_ORIGIN_MISMATCH"),
            ("servedPageManifestDigest", "0" * 64, "CAPTURE_SERVED_PAGE_MISMATCH"),
            ("captureToolchainDigest", "0" * 64, "CAPTURE_TOOLCHAIN_MISMATCH"),
        )
        for field, value, expected in mutations:
            for omitted in (True, False):
                with self.subTest(field=field, omitted=omitted), tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
                    run_path = write_run(root, protocol)
                    run = json.loads(run_path.read_text())
                    receipt_ref = run["candidates"][0]["views"][0]["captures"][0]["receipt"]
                    receipt_path = root / receipt_ref["path"]
                    receipt = json.loads(receipt_path.read_text())
                    receipt.pop(field) if omitted else receipt.__setitem__(field, value)
                    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
                    receipt_ref["sha256"] = sha256(receipt_path)
                    run_path.write_text(json.dumps(run), encoding="utf-8")
                    assert_error(
                        self, "INVALID_CAPTURE_RECEIPT_KEYS" if omitted else expected,
                        lambda: MODULE.evaluate_run(root / "protocol.json", run_path, root / "result.json"),
                    )

    def test_evaluate_rejects_capture_plan_identity_and_semantic_mutations(self) -> None:
        mutations = (
            ("size", "FILE_SIZE_MISMATCH"),
            ("protocol", "CAPTURE_PLAN_PROTOCOL_MISMATCH"),
            ("web-origin", "RUN_CAPTURE_PLAN_ORIGIN_MISMATCH"),
            ("asset-set", "CAPTURE_PLAN_ASSET_SET_MISMATCH"),
            ("runtime-origin", "CAPTURE_PLAN_RUNTIME_ENVIRONMENT_MISMATCH"),
        )
        for mutation, expected in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
                run_path = write_run(root, protocol)
                run = json.loads(run_path.read_text())
                plan_path = root / run["capturePlan"]["path"]
                plan = json.loads(plan_path.read_text())
                if mutation == "size":
                    run["capturePlan"]["sizeBytes"] += 1
                elif mutation == "protocol":
                    plan["protocolDigest"] = "0" * 64
                    rewrite_identity_json(root, run, "capturePlan", plan)
                elif mutation == "web-origin":
                    plan["webOrigin"] = "http://127.0.0.1:4180"
                    rewrite_identity_json(root, run, "capturePlan", plan)
                elif mutation == "asset-set":
                    plan["candidates"][0]["assets"][0]["sha256"] = "0" * 64
                    rewrite_identity_json(root, run, "capturePlan", plan)
                else:
                    plan["candidates"][0]["assetOrigin"] = "http://127.0.0.1:4181"
                    rewrite_identity_json(root, run, "capturePlan", plan)
                run_path.write_text(json.dumps(run), encoding="utf-8")
                assert_error(
                    self, expected,
                    lambda: MODULE.evaluate_run(root / "protocol.json", run_path, root / "result.json"),
                )

    def test_evaluate_rejects_manifest_toolchain_and_retained_page_mutations(self) -> None:
        mutations = (
            ("manifest-omission", "INVALID_SERVED_PAGE_MANIFEST_KEYS"),
            ("manifest-digest", "SERVED_PAGE_MANIFEST_DIGEST_MISMATCH"),
            ("toolchain", "CAPTURE_TOOLCHAIN_DIGEST_MISMATCH"),
            ("run-manifest-digest", "RUN_SERVED_PAGE_MANIFEST_MISMATCH"),
            ("run-toolchain-digest", "RUN_CAPTURE_TOOLCHAIN_MISMATCH"),
            ("retained-byte", "SERVED_PAGE_FILE_MISMATCH"),
            ("retained-addition", "SERVED_PAGE_PATH_SET_MISMATCH"),
            ("retained-deletion", "SERVED_PAGE_PATH_SET_MISMATCH"),
            ("retained-content-type", "SERVED_PAGE_CONTENT_TYPE_MISMATCH"),
            ("retained-hardlink", "LINKED_INPUT_FORBIDDEN"),
        )
        for mutation, expected in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
                run_path = write_run(root, protocol)
                run = json.loads(run_path.read_text())
                manifest_path = root / run["servedPageManifest"]["path"]
                manifest = json.loads(manifest_path.read_text())
                retained_file = root / "served-page" / "index.html"
                if mutation == "manifest-omission":
                    manifest.pop("retainedRoot")
                    rewrite_identity_json(root, run, "servedPageManifest", manifest)
                elif mutation == "manifest-digest":
                    manifest["entries"][0]["sha256"] = "0" * 64
                    rewrite_identity_json(root, run, "servedPageManifest", manifest)
                elif mutation == "toolchain":
                    manifest["captureToolchain"]["packages"][0]["version"] = "9.9.9"
                    rewrite_identity_json(root, run, "servedPageManifest", manifest)
                elif mutation == "run-manifest-digest":
                    run["servedPageManifestDigest"] = "0" * 64
                elif mutation == "run-toolchain-digest":
                    run["captureToolchainDigest"] = "0" * 64
                elif mutation == "retained-byte":
                    retained_file.write_bytes(b"X" + retained_file.read_bytes()[1:])
                elif mutation == "retained-addition":
                    (root / "served-page" / "extra.txt").write_text("extra", encoding="utf-8")
                elif mutation == "retained-deletion":
                    retained_file.unlink()
                elif mutation == "retained-content-type":
                    manifest["entries"][-1]["contentType"] = "application/octet-stream"
                    body = {key: value for key, value in manifest.items() if key != "digest"}
                    manifest["digest"] = component_digest(MODULE.SERVED_PAGE_MANIFEST_DIGEST_DOMAIN, body)
                    rewrite_identity_json(root, run, "servedPageManifest", manifest)
                else:
                    os.link(retained_file, root / "served-page" / "index-copy.html")
                run_path.write_text(json.dumps(run), encoding="utf-8")
                assert_error(
                    self, expected,
                    lambda: MODULE.evaluate_run(root / "protocol.json", run_path, root / "result.json"),
                )

    def test_evaluate_rejects_candidate_specific_color_fitting_and_duplicate_keys(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            run_path = write_run(root, protocol)
            run = json.loads(run_path.read_text())
            run["candidates"][0]["colorTransform"] = {"gain": 1.2}
            run_path.write_text(json.dumps(run), encoding="utf-8")
            assert_error(
                self,
                "INVALID_RUN_KEYS",
                lambda: MODULE.evaluate_run(
                    root / "protocol.json", run_path, root / "result.json", None, None
                ),
            )

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            draft = write_draft(root, heldout=False)
            raw = draft.read_text().replace('"authority": "none"', '"authority": "none", "authority": "none"', 1)
            draft.write_text(raw, encoding="utf-8")
            assert_error(self, "DUPLICATE_JSON_KEY", lambda: MODULE.freeze_protocol(draft, root / "protocol.json"))

    def test_outputs_are_create_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol_path = root / "protocol.json"
            MODULE.freeze_protocol(write_draft(root, heldout=False), protocol_path)
            assert_error(
                self,
                "OUTPUT_EXISTS",
                lambda: MODULE.freeze_protocol(root / "draft.json", protocol_path),
            )

    def test_score_outputs_cannot_overlap_inputs_or_each_other(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            run_path = write_run(root, json.loads((root / "protocol.json").read_text()))
            assert_error(
                self,
                "OUTPUT_OVERLAPS_INPUT",
                lambda: MODULE.evaluate_run(root / "protocol.json", run_path, run_path),
            )
            self.assertEqual(json.loads(run_path.read_text())["schemaVersion"], MODULE.RUN_SCHEMA_VERSION)
            assert_error(
                self,
                "OUTPUT_PATH_REUSED",
                lambda: MODULE.evaluate_run(
                    root / "protocol.json",
                    run_path,
                    root / "same-output",
                    root / "same-output",
                    None,
                    root / "answer-key.json",
                ),
            )

    def test_freeze_requires_narrow_rights_and_captured_reference_pixels(self) -> None:
        mutations = (
            ("INTERNAL_COMPARISON_RIGHTS_REQUIRED", lambda payload: payload["rights"].__setitem__("internalComparisonApproved", False)),
            ("RIGHTS_SCOPE_TOO_BROAD", lambda payload: payload["rights"].__setitem__("publicationApproved", True)),
            ("CAPTURED_REFERENCE_REQUIRED", lambda payload: payload["views"][0]["reference"].__setitem__("generatedPixels", True)),
            ("CAPTURED_REFERENCE_REQUIRED", lambda payload: payload["views"][0]["reference"].__setitem__("candidateDerived", True)),
        )
        for expected, mutate in mutations:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                draft = write_draft(root, heldout=False)
                payload = json.loads(draft.read_text())
                mutate(payload)
                draft.write_text(json.dumps(payload), encoding="utf-8")
                assert_error(self, expected, lambda: MODULE.freeze_protocol(draft, root / "protocol.json"))

    def test_freeze_rejects_heldout_reference_hash_in_candidate_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            draft = write_draft(root, heldout=True)
            payload = json.loads(draft.read_text())
            inventory_ref = payload["candidateInventories"][0]["receipt"]
            inventory_path = root / inventory_ref["path"]
            inventory = json.loads(inventory_path.read_text())
            inventory["usedImageLineage"][0]["developedImageSha256"] = payload["views"][0]["reference"]["image"]["sha256"]
            inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
            payload["candidateInventories"][0]["receipt"] = file_ref(inventory_path)
            draft.write_text(json.dumps(payload), encoding="utf-8")

            assert_error(
                self,
                "HELDOUT_REFERENCE_LINEAGE_LEAKAGE",
                lambda: MODULE.freeze_protocol(draft, root / "protocol.json"),
            )

    def test_freeze_rejects_every_camera_equivalence_break(self) -> None:
        mutations = (
            lambda camera: camera["worldToCamera"].__setitem__(3, 0.1),
            lambda camera: camera["projectionMatrix"].__setitem__(0, camera["projectionMatrix"][0] + 0.1),
            lambda camera: camera["viewport"].__setitem__("devicePixelRatio", 2.0),
            lambda camera: camera["crop"].__setitem__("widthPixels", IMAGE_SIZE - 1),
            lambda camera: camera.__setitem__("distortionCoefficients", [0.01]),
            lambda camera: camera.__setitem__("verticalFovDegrees", 60.0),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                draft = write_draft(root, heldout=False)
                payload = json.loads(draft.read_text())
                mutate(payload["views"][0]["camera"])
                draft.write_text(json.dumps(payload), encoding="utf-8")
                assert_error(
                    self,
                    "UNSUPPORTED_CAMERA",
                    lambda: MODULE.freeze_protocol(draft, root / "protocol.json"),
                )

    def test_freeze_rejects_jpeg_reference_and_hardlinked_input(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            draft = write_draft(root, heldout=False)
            payload = json.loads(draft.read_text())
            source = root / payload["views"][0]["reference"]["image"]["path"]
            jpeg = root / "reference.jpg"
            Image.open(source).save(jpeg, format="JPEG")
            payload["views"][0]["reference"]["image"] = file_ref(jpeg)
            draft.write_text(json.dumps(payload), encoding="utf-8")
            assert_error(
                self,
                "LOSSLESS_PNG_REQUIRED",
                lambda: MODULE.freeze_protocol(draft, root / "protocol.json"),
            )

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            draft = write_draft(root, heldout=False)
            payload = json.loads(draft.read_text())
            source = root / payload["views"][0]["reference"]["image"]["path"]
            hardlink = root / "hardlinked-source.png"
            os.link(source, hardlink)
            payload["views"][0]["reference"]["image"] = file_ref(hardlink)
            draft.write_text(json.dumps(payload), encoding="utf-8")
            assert_error(
                self,
                "LINKED_INPUT_FORBIDDEN",
                lambda: MODULE.freeze_protocol(draft, root / "protocol.json"),
            )

    def test_freeze_rejects_embedded_colour_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            draft = write_draft(root, heldout=False)
            payload = json.loads(draft.read_text())
            reference_path = root / payload["views"][0]["reference"]["image"]["path"]
            with Image.open(reference_path) as opened:
                pixels = np.asarray(opened.convert("RGB"))
            Image.fromarray(pixels, mode="RGB").save(reference_path, icc_profile=b"generated-test-profile")
            payload["views"][0]["reference"]["image"] = file_ref(reference_path)
            draft.write_text(json.dumps(payload), encoding="utf-8")
            assert_error(
                self,
                "EMBEDDED_COLOUR_PROFILE_UNSUPPORTED",
                lambda: MODULE.freeze_protocol(draft, root / "protocol.json"),
            )

    def test_evaluate_rejects_frozen_mask_mutation_and_wrong_common_renderer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            run_path = write_run(root, protocol)
            mask_path = Path(protocol["views"][0]["regions"][0]["mask"]["resolvedPath"])
            mask_path.write_bytes(mask_path.read_bytes() + b"changed")
            assert_error(
                self,
                "FILE_HASH_MISMATCH",
                lambda: MODULE.evaluate_run(
                    root / "protocol.json", run_path, root / "result.json", None, None
                ),
            )

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            run_path = write_run(root, protocol)
            run = json.loads(run_path.read_text())
            run["candidates"][0]["rendererConfigDigest"] = "0" * 64
            run_path.write_text(json.dumps(run), encoding="utf-8")
            assert_error(
                self,
                "CAPTURE_RENDERER_MISMATCH",
                lambda: MODULE.evaluate_run(
                    root / "protocol.json", run_path, root / "result.json", None, None
                ),
            )

    def test_blinded_board_does_not_embed_candidate_names_as_text(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            result = MODULE.evaluate_run(
                root / "protocol.json",
                write_run(root, protocol),
                root / "result.json",
                root / "board.png",
                root / "review.md",
                root / "answer-key.json",
            )
            board = (root / "board.png").read_bytes().lower()
            self.assertNotIn(b"quality", board)
            self.assertNotIn(b"mobile", board)
            self.assertNotIn("blindAnswerKey", result["humanReviewArtifacts"])
            self.assertTrue(result["humanReviewArtifacts"]["regionCropsAtNativePixels"])
            with Image.open(root / "board.png") as image:
                self.assertEqual(image.width, 341)
                self.assertEqual(image.height, 198)
            review_text = (root / "review.md").read_text()
            self.assertIn("row-001", review_text)
            for region in protocol["views"][0]["regions"]:
                self.assertNotIn(region["regionId"], review_text)

    def test_record_review_maps_a_blind_observation_but_never_selects_product_winner(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=True), root / "protocol.json")
            result = MODULE.evaluate_run(
                root / "protocol.json",
                write_run(root, protocol),
                root / "result.json",
                root / "board.png",
                root / "review.md",
                root / "answer-key.json",
            )
            answer_key = json.loads((root / "answer-key.json").read_text())
            preferred_label = next(label for label, candidate in answer_key["mapping"].items() if candidate == "quality")
            completed = write_completed_review(root, result, root / "board.png", preference=preferred_label)

            receipt = MODULE.record_review(
                root / "result.json",
                root / "board.png",
                root / "answer-key.json",
                completed,
                root / "review-receipt.json",
            )

            self.assertEqual(receipt["status"], "review_recorded_directional_observation_only")
            self.assertEqual(receipt["humanDirectionalObservation"], "quality")
            self.assertIsNone(receipt["productWinner"])
            self.assertFalse(receipt["runtimePromotionAuthorized"])

    def test_record_review_keeps_human_machine_disagreement_open(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=True), root / "protocol.json")
            result = MODULE.evaluate_run(
                root / "protocol.json", write_run(root, protocol), root / "result.json",
                root / "board.png", root / "review.md", root / "answer-key.json",
            )
            answer_key = json.loads((root / "answer-key.json").read_text())
            opposite = next(label for label, candidate in answer_key["mapping"].items() if candidate == "mobile")
            completed = write_completed_review(root, result, root / "board.png", preference=opposite)
            receipt = MODULE.record_review(
                root / "result.json", root / "board.png", root / "answer-key.json",
                completed, root / "review-receipt.json",
            )
            self.assertEqual(receipt["status"], "review_recorded_disagreement_gate_open")
            self.assertIsNone(receipt["humanDirectionalObservation"])
            self.assertIsNone(receipt["productWinner"])

    def test_record_review_keeps_ties_and_uncalibrated_displays_open(self) -> None:
        for preference, calibrated in (("tie", True), ("A", False)):
            with self.subTest(preference=preference, calibrated=calibrated), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
                result = MODULE.evaluate_run(
                    root / "protocol.json",
                    write_run(root, protocol),
                    root / "result.json",
                    root / "board.png",
                    root / "review.md",
                    root / "answer-key.json",
                )
                completed = write_completed_review(
                    root,
                    result,
                    root / "board.png",
                    preference=preference,
                    calibrated=calibrated,
                )
                receipt = MODULE.record_review(
                    root / "result.json",
                    root / "board.png",
                    root / "answer-key.json",
                    completed,
                    root / "review-receipt.json",
                )
                self.assertEqual(receipt["status"], "review_recorded_source_diagnostic_only")
                self.assertIsNone(receipt["humanDirectionalObservation"])

    def test_record_review_rejects_tampered_board_and_missing_region(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            result = MODULE.evaluate_run(
                root / "protocol.json",
                write_run(root, protocol),
                root / "result.json",
                root / "board.png",
                root / "review.md",
                root / "answer-key.json",
            )
            completed = write_completed_review(root, result, root / "board.png", preference="A")
            review = json.loads(completed.read_text())
            review["rows"].pop()
            completed.write_text(json.dumps(review), encoding="utf-8")
            assert_error(
                self,
                "REVIEW_ROW_SET_MISMATCH",
                lambda: MODULE.record_review(
                    root / "result.json",
                    root / "board.png",
                    root / "answer-key.json",
                    completed,
                    root / "review-receipt.json",
                ),
            )
            (root / "board.png").write_bytes((root / "board.png").read_bytes() + b"tampered")
            assert_error(
                self,
                "REVIEW_BOARD_MISMATCH",
                lambda: MODULE.record_review(
                    root / "result.json",
                    root / "board.png",
                    root / "answer-key.json",
                    completed,
                    root / "review-receipt.json",
                ),
            )

    def test_record_review_rejects_result_and_resealed_answer_key_tampering(self) -> None:
        for target in ("result", "answer-key"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
                result = MODULE.evaluate_run(
                    root / "protocol.json",
                    write_run(root, protocol),
                    root / "result.json",
                    root / "board.png",
                    root / "review.md",
                    root / "answer-key.json",
                )
                completed = write_completed_review(root, result, root / "board.png", preference="A")
                if target == "result":
                    document = json.loads((root / "result.json").read_text())
                    document["decision"]["productWinner"] = "quality"
                    (root / "result.json").write_text(json.dumps(document), encoding="utf-8")
                    expected = "RESULT_DIGEST_MISMATCH"
                else:
                    key = json.loads((root / "answer-key.json").read_text())
                    del key["answerKeyDigest"]
                    key["mapping"] = {"A": key["mapping"]["B"], "B": key["mapping"]["A"]}
                    resealed = MODULE._seal(key, "answerKeyDigest", MODULE.ANSWER_KEY_DIGEST_DOMAIN)
                    (root / "answer-key.json").write_text(json.dumps(resealed) + "\n", encoding="utf-8")
                    expected = "ANSWER_KEY_FILE_MISMATCH"
                assert_error(
                    self,
                    expected,
                    lambda: MODULE.record_review(
                        root / "result.json",
                        root / "board.png",
                        root / "answer-key.json",
                        completed,
                        root / "review-receipt.json",
                    ),
                )

    def test_production_configuration_deliberately_blocks_heldout_capture(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            draft = write_draft(root, heldout=True)
            trusted = MODULE.TRUSTED_HELDOUT_CAPTURE_RUNNER_SHA256
            MODULE.TRUSTED_HELDOUT_CAPTURE_RUNNER_SHA256 = frozenset()
            try:
                assert_error(
                    self,
                    "HELDOUT_CAPTURE_ADAPTER_NOT_ALLOWLISTED",
                    lambda: MODULE.freeze_protocol(draft, root / "protocol.json"),
                )
            finally:
                MODULE.TRUSTED_HELDOUT_CAPTURE_RUNNER_SHA256 = trusted

    def test_resealed_protocol_is_fully_revalidated_before_scoring(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            protocol = json.loads((root / "protocol.json").read_text())
            protocol["purpose"] = "heldout_physical_comparison"
            del protocol["protocolDigest"]
            protocol = MODULE._seal(protocol, "protocolDigest", MODULE.PROTOCOL_DIGEST_DOMAIN)
            (root / "protocol.json").write_text(json.dumps(protocol), encoding="utf-8")
            assert_error(
                self,
                "HELDOUT_INVENTORY_INCOMPLETE",
                lambda: MODULE.verify_protocol_file(root / "protocol.json"),
            )

    def test_resealed_protocol_cannot_change_package_versions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            protocol = json.loads((root / "protocol.json").read_text())
            protocol["toolEvidence"]["pythonPackages"]["Pillow"] = "0.0-generated-tamper"
            del protocol["protocolDigest"]
            protocol = MODULE._seal(protocol, "protocolDigest", MODULE.PROTOCOL_DIGEST_DOMAIN)
            (root / "protocol.json").write_text(json.dumps(protocol), encoding="utf-8")
            assert_error(
                self,
                "PROTOCOL_SEMANTIC_MISMATCH",
                lambda: MODULE.verify_protocol_file(root / "protocol.json"),
            )

    def test_heldout_views_require_distinct_stations_and_acquisitions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=True), root / "protocol.json")
            repeated_pose = copy.deepcopy(protocol["views"])
            repeated_pose[1]["camera"] = copy.deepcopy(repeated_pose[0]["camera"])
            assert_error(
                self,
                "HELDOUT_CAMERA_POSES_NOT_DISTINCT",
                lambda: MODULE._validate_view_coverage(repeated_pose, True),
            )
            repeated_capture = copy.deepcopy(protocol["views"])
            for key in ("captureId", "sourceIdentityId", "rawSourceSha256", "developedImageSha256"):
                repeated_capture[1]["reference"]["acquisitionReceipts"][0]["data"][key] = repeated_capture[0]["reference"]["acquisitionReceipts"][0]["data"][key]
            assert_error(
                self,
                "HELDOUT_REFERENCE_ACQUISITION_REUSED",
                lambda: MODULE._validate_view_coverage(repeated_capture, True),
            )

    def test_heldout_rejects_same_raw_under_a_different_development(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            draft = write_draft(root, heldout=True)
            payload = json.loads(draft.read_text())
            acquisition = json.loads((root / payload["views"][0]["reference"]["acquisitionReceipts"][0]["path"]).read_text())
            inventory_path = root / payload["candidateInventories"][0]["receipt"]["path"]
            inventory = json.loads(inventory_path.read_text())
            inventory["usedImageLineage"][0]["rawSourceSha256"] = acquisition["rawSourceSha256"]
            inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
            payload["candidateInventories"][0]["receipt"] = file_ref(inventory_path)
            draft.write_text(json.dumps(payload), encoding="utf-8")
            assert_error(self, "HELDOUT_REFERENCE_LINEAGE_LEAKAGE", lambda: MODULE.freeze_protocol(draft, root / "protocol.json"))

    def test_outside_mask_pixels_cannot_change_any_metric(self) -> None:
        reference = room_pattern(4)
        candidate = reference.copy()
        mask = np.zeros((IMAGE_SIZE, IMAGE_SIZE), dtype=bool)
        mask[10:86, 10:86] = True
        candidate[~mask] = 255 - candidate[~mask]
        unchanged = MODULE.compare_masked_arrays(reference, reference, mask)
        outside_changed = MODULE.compare_masked_arrays(reference, candidate, mask)
        self.assertEqual(unchanged, outside_changed)

    def test_acquisition_count_mismatch_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            draft = write_draft(root, heldout=False)
            payload = json.loads(draft.read_text())
            receipts = payload["views"][0]["reference"]["acquisitionReceipts"]
            receipts.append(copy.deepcopy(receipts[0]))
            draft.write_text(json.dumps(payload), encoding="utf-8")
            assert_error(self, "REFERENCE_ACQUISITION_COUNT_MISMATCH", lambda: MODULE.freeze_protocol(draft, root / "protocol.json"))

    def test_run_candidate_and_runner_must_match_frozen_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            run_path = write_run(root, protocol)
            run = json.loads(run_path.read_text())
            run["candidates"][0]["assetSha256"] = hashlib.sha256(b"substitute").hexdigest()
            run_path.write_text(json.dumps(run), encoding="utf-8")
            assert_error(self, "CAPTURE_CANDIDATE_BINDING_MISMATCH", lambda: MODULE.evaluate_run(root / "protocol.json", run_path, root / "result.json"))

    def test_answer_key_uses_unpredictable_nonce(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            protocol = MODULE.freeze_protocol(write_draft(root, heldout=False), root / "protocol.json")
            first = MODULE._answer_key_bytes(protocol, b"same-board", {"A": "quality", "B": "mobile"})
            second = MODULE._answer_key_bytes(protocol, b"same-board", {"A": "quality", "B": "mobile"})
            self.assertNotEqual(first, second)
            self.assertEqual(len(json.loads(first)["blindingNonce"]), 64)


if __name__ == "__main__":
    unittest.main()
