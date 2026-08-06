#!/usr/bin/env python3
"""Build a create-only, method-specific E57 holdout camera receipt.

This command reads only the two already-existing JSON evidence receipts used by
``build_e57_matched_camera_views.py``.  It never opens the E57, a JPEG, a pose
sidecar, a renderer, or a network connection.

The original validation receipt is checked first with the unmodified frozen
base tool.  Only after that succeeds does this extension temporarily install a
strict 126/129/141 profile in the verified base module, derive Skybox 4 camera
rows, compare them exactly with independently recorded viewer cameras, and
restore every changed base global in a ``finally`` block.

The resulting cameras are an internal, method-specific holdout aid.  The
stations appeared in earlier diagnostics, so the receipt explicitly denies
global pristine/unseen status, physical approval, training, promotion, and
public release.
"""

from __future__ import annotations

import argparse
import copy
from contextlib import contextmanager
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import threading
from typing import Any, Iterable, Iterator, Sequence


SCHEMA_VERSION = "omnitwin.reception.e57-method-holdout-camera-views.v1"
BASE_TOOL_FILE_NAME = "build_e57_matched_camera_views.py"
BASE_TOOL_SHA256 = "9a37cb8fd1d3b755168be6e63d8796de3d6eee9ba64e0fbc8d7ed89fe8e7d154"
REGISTRATION_FILE_SHA256 = "81dadda64ba0a25c0d073ce60ee8d9bf39baa166aaa8a46cd3d859eaacaa9927"
REPROJECTION_FILE_SHA256 = "7e1a881c3fdf613a9fa8ddcb1f6c11db582318b0b61ec26452b564a8dee3b4ad"
HOLDOUT_SCAN_IDS = (126, 129, 141)
ORIGINAL_VALIDATION_SCAN_IDS = (131, 134, 138)
SKYBOX_NAME = "Skybox 4"
RECEIPT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_METHOD_HOLDOUT_CAMERA_VIEWS_V1\0"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

EXPECTED_IMAGES: dict[int, dict[str, Any]] = {
    126: {
        "image2DIndex": 760,
        "image2DGuid": "55fde40f78734299bc99ae05863b0837",
        "data3DGuid": "55fde40f78734299bc99ae05863b0832",
        "jpegSha256": "777e6850400aff1f8d75cc39de94de847e07f7f3c8708d420b82c4c73f56165b",
        "jpegSizeBytes": 2_787_216,
        "width": 4096,
        "height": 4096,
    },
    129: {
        "image2DIndex": 778,
        "image2DGuid": "b80ea44013204e87a581b1735db4656e",
        "data3DGuid": "b80ea44013204e87a581b1735db46569",
        "jpegSha256": "8d5f13607d1c094297bb6b3688464d1a8ae6a4555ec51b610aa5cdce2c99fd9e",
        "jpegSizeBytes": 2_864_361,
        "width": 4096,
        "height": 4096,
    },
    141: {
        "image2DIndex": 850,
        "image2DGuid": "33de3f9e46a24d83b257d67f3317dca2",
        "data3DGuid": "33de3f9e46a24d83b257d67f3317dc9d",
        "jpegSha256": "747dbd122ae66c7815f1414100429a7704b8efbf84203f5ef5912c78b2dab677",
        "jpegSizeBytes": 2_899_217,
        "width": 4096,
        "height": 4096,
    },
}

# Independently calculated from the written transform/camera equations before
# this production extension was implemented.  Equality is exact: a pose that
# is merely close is not admitted as the frozen method-specific camera.
EXPECTED_VIEWER_CAMERAS: dict[int, dict[str, Any]] = {
    126: {
        "fovDegrees": 90.0,
        "positionMeters": [
            -0.015042601625986696,
            0.08778269923731363,
            3.3176856097911442,
        ],
        "lookAtMeters": [
            0.7084655840147923,
            0.03681151564596519,
            8.264799702244852,
        ],
        "up": [
            -0.03670850146482087,
            0.9992032518253366,
            0.015663571172629332,
        ],
    },
    129: {
        "fovDegrees": 90.0,
        "positionMeters": [
            -4.664192565366382,
            0.06505807083731363,
            2.050259748364862,
        ],
        "lookAtMeters": [
            -3.73780163116714,
            -0.02932846361957364,
            6.962783643385288,
        ],
        "up": [
            -0.027721792722342622,
            0.9993171535435732,
            0.02442803393295826,
        ],
    },
    141: {
        "fovDegrees": 90.0,
        "positionMeters": [
            0.013857139708918442,
            0.09685667193731362,
            7.615894865400145,
        ],
        "lookAtMeters": [
            1.3045925049586193,
            0.21483382697094588,
            12.444982109153763,
        ],
        "up": [
            0.024747912728282973,
            0.9992121540239711,
            -0.031025990175490025,
        ],
    },
}


class HoldoutCameraReceiptError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


def fail(code: str, message: str) -> None:
    raise HoldoutCameraReceiptError(code, message)


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _load_pinned_base_tool() -> tuple[Any, dict[str, Any]]:
    path = Path(__file__).resolve().with_name(BASE_TOOL_FILE_NAME)
    try:
        before = path.stat()
        raw = path.read_bytes()
        after = path.stat()
    except OSError as error:
        raise RuntimeError(f"pinned base camera tool is not readable: {error}") from error
    if (
        before.st_size <= 0
        or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        or len(raw) != before.st_size
    ):
        raise RuntimeError("pinned base camera tool changed while it was read")
    digest = _sha256_bytes(raw)
    if digest != BASE_TOOL_SHA256:
        raise RuntimeError(
            "pinned base camera tool SHA-256 mismatch: "
            f"expected {BASE_TOOL_SHA256}, got {digest}"
        )
    spec = importlib.util.spec_from_file_location(
        "omnitwin_reception_frozen_matched_camera_base", path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("could not create an import specification for the base camera tool")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if _sha256_bytes(path.read_bytes()) != BASE_TOOL_SHA256:
        raise RuntimeError("pinned base camera tool changed during import")
    return module, {"path": str(path), "sha256": digest, "sizeBytes": len(raw)}


BASE, BASE_TOOL_EVIDENCE = _load_pinned_base_tool()
_BASE_SCOPE_LOCK = threading.RLock()


def _translate_base_error(error: Exception) -> HoldoutCameraReceiptError:
    if isinstance(error, BASE.CameraReceiptError):
        return HoldoutCameraReceiptError(error.code, error.message)
    return HoldoutCameraReceiptError("BASE_TOOL_FAILURE", str(error))


def _stable_current_base_evidence() -> dict[str, Any]:
    try:
        evidence = BASE._tool_evidence(Path(BASE_TOOL_EVIDENCE["path"]))
    except Exception as error:
        raise _translate_base_error(error) from error
    if evidence != BASE_TOOL_EVIDENCE:
        fail("BASE_TOOL_PIN_MISMATCH", "base camera tool no longer matches the imported frozen bytes")
    return dict(evidence)


def _validate_evidence(value: dict[str, Any], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("INVALID_EVIDENCE", f"{label} evidence must be an object")
    if set(value) != {"path", "sha256", "sizeBytes"}:
        fail("INVALID_EVIDENCE", f"{label} evidence keys are not exact")
    path = value.get("path")
    digest = value.get("sha256")
    size = value.get("sizeBytes")
    if (
        not isinstance(path, str)
        or not path
        or not isinstance(digest, str)
        or SHA256_RE.fullmatch(digest) is None
        or isinstance(size, bool)
        or not isinstance(size, int)
        or size <= 0
    ):
        fail("INVALID_EVIDENCE", f"{label} evidence is malformed")
    return {"path": path, "sha256": digest, "sizeBytes": size}


def _require_file_pins(
    registration_evidence: dict[str, Any], reprojection_evidence: dict[str, Any]
) -> None:
    if registration_evidence["sha256"] != REGISTRATION_FILE_SHA256:
        fail("REGISTRATION_FILE_PIN_MISMATCH", "registration receipt file hash changed")
    if reprojection_evidence["sha256"] != REPROJECTION_FILE_SHA256:
        fail("REPROJECTION_FILE_PIN_MISMATCH", "reprojection report file hash changed")


@contextmanager
def _temporary_holdout_base_scope() -> Iterator[None]:
    """Install the holdout constants and always restore original object identities."""

    with _BASE_SCOPE_LOCK:
        originals = {
            "EXPECTED_SCAN_IDS": BASE.EXPECTED_SCAN_IDS,
            "FROZEN_TEST_SCAN_IDS": BASE.FROZEN_TEST_SCAN_IDS,
            "EXPECTED_IMAGES": BASE.EXPECTED_IMAGES,
        }
        try:
            BASE.EXPECTED_SCAN_IDS = HOLDOUT_SCAN_IDS
            BASE.FROZEN_TEST_SCAN_IDS = ORIGINAL_VALIDATION_SCAN_IDS
            BASE.EXPECTED_IMAGES = copy.deepcopy(EXPECTED_IMAGES)
            yield
        finally:
            BASE.EXPECTED_SCAN_IDS = originals["EXPECTED_SCAN_IDS"]
            BASE.FROZEN_TEST_SCAN_IDS = originals["FROZEN_TEST_SCAN_IDS"]
            BASE.EXPECTED_IMAGES = originals["EXPECTED_IMAGES"]


def _exact_holdout_view(view: dict[str, Any]) -> dict[str, Any]:
    scan_id = view.get("scanId")
    expected = EXPECTED_VIEWER_CAMERAS.get(scan_id)
    if expected is None:
        fail("WRONG_SCAN_OR_FACE", "base derivation returned an unapproved holdout scan")
    if view.get("skyboxName") != SKYBOX_NAME:
        fail("WRONG_SCAN_OR_FACE", f"scan {scan_id} did not use {SKYBOX_NAME}")
    if view.get("viewerCamera") != expected:
        fail(
            "VIEWER_CAMERA_PIN_MISMATCH",
            f"scan {scan_id} derived camera differs from the independently recorded camera",
        )
    result = copy.deepcopy(view)
    result["viewerCamera"] = copy.deepcopy(expected)
    view_id = f"e57-method-holdout-scan-{scan_id}-skybox-4"
    parameters = {
        "camera": BASE._vector_parameter(expected["positionMeters"]),
        "lookAt": BASE._vector_parameter(expected["lookAtMeters"]),
        "up": BASE._vector_parameter(expected["up"]),
        "fov": BASE._decimal(expected["fovDegrees"]),
        "experimentalViewId": view_id,
    }
    result["experimentalQuery"] = {
        "parameters": parameters,
        "search": (
            f"?camera={parameters['camera']}&lookAt={parameters['lookAt']}"
            f"&up={parameters['up']}&fov={parameters['fov']}"
            f"&experimentalViewId={parameters['experimentalViewId']}"
        ),
    }
    result["checks"] = {
        **result["checks"],
        "exactIndependentViewerCameraPinMatched": True,
        "methodSpecificHoldoutOnly": True,
    }
    return result


def _seal(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    digest = _sha256_bytes(RECEIPT_DIGEST_DOMAIN + BASE._canonical_json_bytes(unsigned))
    return {
        **unsigned,
        "receipt": {
            "algorithm": "sha256",
            "domain": "OMNITWIN_RECEPTION_E57_METHOD_HOLDOUT_CAMERA_VIEWS_V1\\0",
            "sha256": digest,
            "authenticatesCreator": False,
            "provesTrustedTimestamp": False,
            "provesOneTimeExecution": False,
        },
    }


def verify_receipt(document: dict[str, Any]) -> None:
    if not isinstance(document, dict):
        fail("INVALID_RECEIPT", "receipt root must be an object")
    receipt = document.get("receipt")
    if not isinstance(receipt, dict) or set(receipt) != {
        "algorithm",
        "domain",
        "sha256",
        "authenticatesCreator",
        "provesTrustedTimestamp",
        "provesOneTimeExecution",
    }:
        fail("INVALID_RECEIPT", "self-digest record is missing or malformed")
    if (
        receipt.get("algorithm") != "sha256"
        or receipt.get("domain")
        != "OMNITWIN_RECEPTION_E57_METHOD_HOLDOUT_CAMERA_VIEWS_V1\\0"
        or receipt.get("authenticatesCreator") is not False
        or receipt.get("provesTrustedTimestamp") is not False
        or receipt.get("provesOneTimeExecution") is not False
    ):
        fail("INVALID_RECEIPT", "self-digest safety meaning changed")
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    actual = _sha256_bytes(RECEIPT_DIGEST_DOMAIN + BASE._canonical_json_bytes(unsigned))
    if receipt.get("sha256") != actual:
        fail("RECEIPT_DIGEST_MISMATCH", "holdout camera receipt self-digest does not verify")


def build_receipt(
    registration_document: dict[str, Any],
    reprojection_document: dict[str, Any],
    *,
    registration_evidence: dict[str, Any],
    reprojection_evidence: dict[str, Any],
    tool_evidence: dict[str, Any],
    enforce_frozen_pins: bool = True,
) -> dict[str, Any]:
    registration_evidence = _validate_evidence(registration_evidence, "registration")
    reprojection_evidence = _validate_evidence(reprojection_evidence, "reprojection")
    tool_evidence = _validate_evidence(tool_evidence, "holdout tool")
    base_tool_evidence = _stable_current_base_evidence()
    if enforce_frozen_pins:
        _require_file_pins(registration_evidence, reprojection_evidence)

    # This call must remain before the temporary holdout scope.  It proves that
    # the original frozen 131/134/138 validation receipts still satisfy the
    # original unmodified camera tool before any holdout row is considered.
    try:
        validated_base_receipt = BASE.build_receipt(
            registration_document,
            reprojection_document,
            registration_evidence=registration_evidence,
            reprojection_evidence=reprojection_evidence,
            tool_evidence=base_tool_evidence,
            enforce_frozen_pins=enforce_frozen_pins,
        )
    except Exception as error:
        raise _translate_base_error(error) from error

    derivation = validated_base_receipt["derivation"]
    rotation = tuple(tuple(row) for row in derivation["registrationRotationRowMajor"])
    translation = tuple(derivation["registrationTranslationMeters"])
    viewer_min = tuple(derivation["viewerDeclaredBoundsMeters"]["minimum"])
    viewer_max = tuple(derivation["viewerDeclaredBoundsMeters"]["maximum"])

    try:
        with _temporary_holdout_base_scope():
            BASE._validate_reprojection_envelope(
                reprojection_document, enforce_frozen_pin=enforce_frozen_pins
            )
            rows = BASE._select_validation_rows(reprojection_document)
            views = [
                _exact_holdout_view(
                    BASE._derive_view(row, rotation, translation, viewer_min, viewer_max)
                )
                for row in rows
            ]
    except HoldoutCameraReceiptError:
        raise
    except Exception as error:
        raise _translate_base_error(error) from error

    if [view["scanId"] for view in views] != list(HOLDOUT_SCAN_IDS):
        fail("HOLDOUT_SCAN_SET_MISMATCH", "derived holdout rows are not exactly 126/129/141")

    report = {
        "schemaVersion": SCHEMA_VERSION,
        "authority": "none",
        "scope": {
            "purpose": "private method-specific matched-render holdout camera derivation",
            "selectedScanIds": list(HOLDOUT_SCAN_IDS),
            "selectedSkyboxName": SKYBOX_NAME,
            "methodSpecificHoldout": True,
            "globallyPristine": False,
            "globallyUnseen": False,
            "originalFrozenValidationValidatedFirst": True,
            "originalValidationScanIds": list(ORIGINAL_VALIDATION_SCAN_IDS),
            "rawE57Read": False,
            "jpegBytesRead": False,
            "jpegPixelsDecoded": False,
            "externalPoseFileRead": False,
            "sourceJsonReportsRead": True,
        },
        "contaminationAndProvenance": {
            "priorDiagnosticsUsedTheseStations": True,
            "reservationPredatesThisMatchedRenderScoreOnly": True,
            "plainLanguage": (
                "Scans 126, 129, and 141 were excluded from the frozen Potree/E57 "
                "registration diagnostic and from the first matched-render scorer, but they "
                "are not globally unseen. Earlier panorama, native-image, LiDAR-reprojection, "
                "and geometry-edge diagnostics used these stations; scan 141 Skybox 4 was "
                "also materialized in a prior diagnostic package. This receipt therefore "
                "supports only a method-specific locked replication."
            ),
            "trustedTimestampAvailable": False,
            "cryptographicProofOfOneTimeExecutionAvailable": False,
        },
        "inputs": {
            "registrationReceipt": {
                **registration_evidence,
                "payloadSha256": registration_document.get("payloadSha256"),
                "schemaVersion": registration_document.get("schemaVersion"),
            },
            "reprojectionReport": {
                **reprojection_evidence,
                "payloadSha256": reprojection_document.get("payloadSha256"),
                "schemaVersion": reprojection_document.get("schemaVersion"),
            },
            "baseCameraTool": base_tool_evidence,
            "holdoutCameraTool": tool_evidence,
            "validatedOriginalCameraReceiptPayloadSha256": validated_base_receipt.get(
                "payloadSha256"
            ),
        },
        "derivation": {
            **copy.deepcopy(derivation),
            "holdoutProfileInstalledOnlyAfterOriginalValidation": True,
            "baseGlobalsRestoredAfterDerivation": True,
            "exactIndependentViewerCameraPinsRequired": True,
        },
        "views": views,
        "usageLimits": {
            "physicalApprovalGranted": False,
            "runtimePromotionPermitted": False,
            "trainingPermitted": False,
            "publicReleasePermitted": False,
            "rightsDecisionMade": False,
            "plainLanguage": (
                "These private cameras may be used once with the separately frozen matched-"
                "render holdout method. They do not approve either candidate, permit training "
                "or publication, or establish physical accuracy."
            ),
        },
    }
    sealed = _seal(report)
    verify_receipt(sealed)
    return sealed


def _write_create_only(
    path: Path, document: dict[str, Any], protected: Iterable[Path]
) -> Path:
    try:
        return BASE._write_create_only(path, document, protected)
    except Exception as error:
        raise _translate_base_error(error) from error


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registration-receipt", type=Path, required=True)
    parser.add_argument("--reprojection-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        registration, registration_evidence = BASE._read_json(
            arguments.registration_receipt, "registration receipt"
        )
        reprojection, reprojection_evidence = BASE._read_json(
            arguments.reprojection_report, "reprojection report"
        )
        tool_evidence = BASE._tool_evidence(Path(__file__))
        receipt = build_receipt(
            registration,
            reprojection,
            registration_evidence=registration_evidence,
            reprojection_evidence=reprojection_evidence,
            tool_evidence=tool_evidence,
        )
        output = _write_create_only(
            arguments.output,
            receipt,
            (
                arguments.registration_receipt,
                arguments.reprojection_report,
                Path(__file__),
                Path(BASE_TOOL_EVIDENCE["path"]),
            ),
        )
    except (HoldoutCameraReceiptError, BASE.CameraReceiptError) as error:
        code = getattr(error, "code", "HOLDOUT_CAMERA_RECEIPT_ERROR")
        message = getattr(error, "message", str(error))
        print(json.dumps({"error": {"code": code, "message": message}}), file=sys.stderr)
        return 2
    print(
        json.dumps(
            {
                "authority": "none",
                "globallyPristine": False,
                "methodSpecificHoldout": True,
                "output": str(output),
                "receiptSha256": receipt["receipt"]["sha256"],
                "schemaVersion": receipt["schemaVersion"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
