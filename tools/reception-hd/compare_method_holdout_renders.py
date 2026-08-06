"""Fail-closed computer-vision scoring for the Reception method holdout.

This wrapper accepts only scans 126, 129, and 141, only the Quality and
Mobile candidates, and only a separately frozen protocol.  It imports the
metric and directional-decision implementation from ``compare_matched_renders``
instead of copying or changing that method.

Protocol freezing stream-hashes the eight declared runtime source assets from
both disk and their exact loopback HTTP responses before capture.  Scoring
repeats those checks after capture, then reads the bound JPEG inputs.  Neither
operation opens the E57, camera receipt, or transform receipt.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat as stat_module
import sys
from typing import Any, NamedTuple, Sequence
import http.client
from urllib.parse import urlencode
from urllib.parse import urlsplit


SCORING_DEPENDENCY_RELATIVE_PATH = "tools/reception-hd/compare_matched_renders.py"
WRAPPER_RELATIVE_PATH = "tools/reception-hd/compare_method_holdout_renders.py"
CAMERA_BUILDER_RELATIVE_PATH = (
    "tools/reception-hd/build_e57_method_holdout_camera_views.py"
)
EXTRACTOR_RELATIVE_PATH = "tools/reception-hd/extract_e57_method_holdout_images.py"
TRANSFORM_EVALUATOR_RELATIVE_PATH = (
    "tools/reception-hd/evaluate_e57_method_holdout_transform.py"
)
VIEWER_CODE_RELATIVE_PATHS = (
    "packages/web/package.json",
    "packages/web/src/components/scene/SparkSplatLayer.tsx",
    "packages/web/src/global.css",
    "packages/web/src/main.tsx",
    "packages/web/src/pages/living-hall/LivingHallLocalPreflightPage.tsx",
    "packages/web/src/pages/living-hall/LivingHallPage.tsx",
    "packages/web/src/pages/living-hall/LivingHallScene.tsx",
    "packages/web/src/pages/living-hall/living-hall.css",
    "packages/web/src/pages/living-hall/reception-experimental-camera.ts",
    "packages/web/src/pages/living-hall/reception-local-preflight.ts",
    "packages/web/src/pages/living-hall/reception-review-views.ts",
    "packages/web/src/pages/living-hall/reception-runtime-profiles.ts",
    "packages/web/src/pages/living-hall/reception-viewer-profile.ts",
    "packages/web/src/router.tsx",
    "packages/web/vite.config.ts",
    "pnpm-lock.yaml",
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCORING_DEPENDENCY_PATH = REPOSITORY_ROOT / SCORING_DEPENDENCY_RELATIVE_PATH


def _import_scoring_dependency() -> tuple[Any, str]:
    payload = SCORING_DEPENDENCY_PATH.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    specification = importlib.util.spec_from_file_location(
        "venviewer_reception_compare_matched_renders", SCORING_DEPENDENCY_PATH
    )
    if specification is None or specification.loader is None:
        raise RuntimeError("cannot import the pinned matched-render scorer")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    if hashlib.sha256(SCORING_DEPENDENCY_PATH.read_bytes()).hexdigest() != digest:
        raise RuntimeError("matched-render scorer changed while it was imported")
    return module, digest


BASE, IMPORTED_SCORING_DEPENDENCY_SHA256 = _import_scoring_dependency()
IMPORTED_WRAPPER_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
ComparisonError = BASE.ComparisonError
ImageRecord = BASE.ImageRecord

PROTOCOL_SCHEMA_VERSION = "venviewer.reception-e57-method-holdout-cv-protocol.v1"
PROTOCOL_STATUS = "frozen_before_method_specific_holdout_render_scoring"
MANIFEST_SCHEMA_VERSION = "venviewer.reception-e57-method-holdout-cv-input.v1"
RESULT_SCHEMA_VERSION = "venviewer.reception-e57-method-holdout-cv-result.v1"
RESULT_STATUS = "method_specific_holdout_directional_result"
AUTHORITY = "none"
ROOM_LABEL = "Reception Room"
METHOD_SCOPE = "matched_render_method_specific_holdout_only"
REFERENCE_FACE_NAME = "Skybox 4"
CAPTURE_ENCODING = "browser_tab_screenshot_jpeg"
CAPTURE_ORIGIN = "http://127.0.0.1:5175"
CAPTURE_ROUTE = "/dev/reception-quality-preflight"
CAPTURE_VIEWPORT_METHOD = "viewportCap.set({width:1024,height:1024})"
CAPTURE_BROWSER_METHOD = "tab.screenshot({fullPage:true})"
RENDER_PROFILE_ID = "reception-fixed-fine-review-v1"
DECISION_RULE = "reuse_compare_matched_renders_directional_rule_v1"
SOURCE_ASSET_VERIFICATION_METHOD = (
    "stream_sha256_disk_and_loopback_http_response_v1"
)
SOURCE_HTTP_TIMEOUT_SECONDS = 30
SOURCE_HASH_CHUNK_BYTES = 1024 * 1024

SCAN_IDS = (126, 129, 141)
CANDIDATE_IDS = ("quality", "mobile")
EXPECTED_COMPARISON: dict[str, int] = {
    "width": 1024,
    "height": 1024,
    "borderPixels": 24,
}
CAPTURE_CAMERA_PARAMETERS = {
    126: {
        "camera": "-0.015042601625986696,0.087782699237313633,3.3176856097911442",
        "lookAt": "0.70846558401479232,0.036811515645965187,8.2647997022448525",
        "up": "-0.036708501464820867,0.99920325182533665,0.015663571172629332",
    },
    129: {
        "camera": "-4.664192565366382,0.065058070837313631,2.0502597483648621",
        "lookAt": "-3.73780163116714,-0.029328463619573641,6.9627836433852881",
        "up": "-0.027721792722342622,0.9993171535435732,0.024428033932958261",
    },
    141: {
        "camera": "0.013857139708918442,0.096856671937313621,7.6158948654001453",
        "lookAt": "1.3045925049586193,0.21483382697094588,12.444982109153763",
        "up": "0.024747912728282973,0.99921215402397112,-0.031025990175490025",
    },
}
CAPTURE_ORDINALS = {
    (126, "quality", "render"): 1,
    (126, "quality", "repeat"): 2,
    (126, "mobile", "render"): 3,
    (126, "mobile", "repeat"): 4,
    (129, "quality", "render"): 5,
    (129, "mobile", "render"): 6,
    (141, "quality", "render"): 7,
    (141, "mobile", "render"): 8,
}
EXPECTED_REFERENCE_JPEGS: dict[int, dict[str, Any]] = {
    126: {
        "scanId": 126,
        "faceName": REFERENCE_FACE_NAME,
        "width": 4096,
        "height": 4096,
        "sizeBytes": 2_787_216,
        "sha256": "777e6850400aff1f8d75cc39de94de847e07f7f3c8708d420b82c4c73f56165b",
    },
    129: {
        "scanId": 129,
        "faceName": REFERENCE_FACE_NAME,
        "width": 4096,
        "height": 4096,
        "sizeBytes": 2_864_361,
        "sha256": "8d5f13607d1c094297bb6b3688464d1a8ae6a4555ec51b610aa5cdce2c99fd9e",
    },
    141: {
        "scanId": 141,
        "faceName": REFERENCE_FACE_NAME,
        "width": 4096,
        "height": 4096,
        "sizeBytes": 2_899_217,
        "sha256": "747dbd122ae66c7815f1414100429a7704b8efbf84203f5ef5912c78b2dab677",
    },
}
EXPECTED_SOURCE_E57 = {
    "fileName": "cloud_0.e57",
    "sizeBytes": 20_518_437_888,
    "sha256": "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
}
EXPECTED_CANDIDATE_SOURCE_PROFILES = {
    "quality": {
        "profileId": "quality-sog-fine-v1",
        "expectedGaussianCount": 2_002_009,
        "assets": [
            {
                "fileName": "0_15_0_0.sog",
                "path": (
                    "C:\\Users\\blake\\omnitwin2\\packages\\web\\public\\splats\\"
                    "reception\\0_15_0_0.sog"
                ),
                "url": "http://127.0.0.1:5175/splats/reception/0_15_0_0.sog",
                "sizeBytes": 10_279_160,
                "sha256": "111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368",
            },
            {
                "fileName": "0_1_0_5.sog",
                "path": (
                    "C:\\Users\\blake\\omnitwin2\\packages\\web\\public\\splats\\"
                    "reception\\0_1_0_5.sog"
                ),
                "url": "http://127.0.0.1:5175/splats/reception/0_1_0_5.sog",
                "sizeBytes": 10_047_085,
                "sha256": "559dd375950966f8d1aa088a391b7105e364abc5013e7d29ea573728ab208fe1",
            },
            {
                "fileName": "0_6_0_0.sog",
                "path": (
                    "C:\\Users\\blake\\omnitwin2\\packages\\web\\public\\splats\\"
                    "reception\\0_6_0_0.sog"
                ),
                "url": "http://127.0.0.1:5175/splats/reception/0_6_0_0.sog",
                "sizeBytes": 10_368_228,
                "sha256": "182525354cd14fa6bc8f6a54c0cbe0e39b5d5c216dd27e2cc4d44d1458ba8238",
            },
            {
                "fileName": "0_7_0_0.sog",
                "path": (
                    "C:\\Users\\blake\\omnitwin2\\packages\\web\\public\\splats\\"
                    "reception\\0_7_0_0.sog"
                ),
                "url": "http://127.0.0.1:5175/splats/reception/0_7_0_0.sog",
                "sizeBytes": 5_040_628,
                "sha256": "3b68d24538523a559730e14d5ed1733f67d9894354e26322e20cf5f4458ccebf",
            },
        ],
    },
    "mobile": {
        "profileId": "mobile-spz-fine-v1",
        "expectedGaussianCount": 1_978_258,
        "assets": [
            {
                "fileName": "0_13_0_0.spz",
                "path": (
                    "C:\\Users\\blake\\Downloads\\reception-room_xgrids_lcc2_spz_visual\\"
                    "lcc2-result\\data\\3dgs\\0_13_0_0.spz"
                ),
                "url": "http://127.0.0.1:4174/0_13_0_0.spz",
                "sizeBytes": 8_620_036,
                "sha256": "82bbbd033609f99f05c45c177ada552b87b905255ac515014f75561c292bf55c",
            },
            {
                "fileName": "0_3_0_0.spz",
                "path": (
                    "C:\\Users\\blake\\Downloads\\reception-room_xgrids_lcc2_spz_visual\\"
                    "lcc2-result\\data\\3dgs\\0_3_0_0.spz"
                ),
                "url": "http://127.0.0.1:4174/0_3_0_0.spz",
                "sizeBytes": 9_199_830,
                "sha256": "13200d905d50160034538e705b60c549aaf82348679791f801efa3f9e52171b3",
            },
            {
                "fileName": "0_7_0_1.spz",
                "path": (
                    "C:\\Users\\blake\\Downloads\\reception-room_xgrids_lcc2_spz_visual\\"
                    "lcc2-result\\data\\3dgs\\0_7_0_1.spz"
                ),
                "url": "http://127.0.0.1:4174/0_7_0_1.spz",
                "sizeBytes": 8_768_751,
                "sha256": "5d4e274df25aae56a8989416e1078fc86912b4c7b053b1c7d3c25a6e484a80df",
            },
            {
                "fileName": "0_8_0_0.spz",
                "path": (
                    "C:\\Users\\blake\\Downloads\\reception-room_xgrids_lcc2_spz_visual\\"
                    "lcc2-result\\data\\3dgs\\0_8_0_0.spz"
                ),
                "url": "http://127.0.0.1:4174/0_8_0_0.spz",
                "sizeBytes": 3_422_064,
                "sha256": "925c90a714abf7ed9cacea65a4abf4de1ff225ead2ef503aadcf836068ab62ed",
            },
        ],
    },
}

EXPECTED_CAMERA_RECEIPT = {
    "path": (
        "C:\\Users\\blake\\Documents\\Codex\\2026-07-12\\new-chat-2\\"
        "reception-e57-method-holdout-camera-views-2026-07-17.json"
    ),
    "sha256": "8a0b1d344bbd646b9011057c05a58b88101e9db0a3fd5ca3158c8bb7579204af",
    "receiptSha256": "1261ce82949d1f8e77d9e2926fb95984787c203c343c47d2a12ca4ec42eb77d4",
    "schemaVersion": "omnitwin.reception.e57-method-holdout-camera-views.v1",
}
EXPECTED_TRANSFORM_RECEIPT = {
    "path": (
        "C:\\Users\\blake\\Documents\\Codex\\2026-07-12\\new-chat-2\\"
        "reception-e57-method-holdout-transform-2026-07-17.json"
    ),
    "sha256": "552b0c57a72026b8f73df66561ed9bc5d7e2a5c27f8db904c39c621fa35064d0",
    "receiptSha256": "8b58911a9676917e5ae09f0ae2ac223e3bd86ab6802fd0cbc978440fe5509662",
    "schemaVersion": "omnitwin.reception.e57-method-holdout-transform-evaluation.v1",
}

PROTOCOL_DIGEST_DOMAIN = b"venviewer.reception-e57-method-holdout-cv-protocol.v1\x00"
RESULT_DIGEST_DOMAIN = b"venviewer.reception-e57-method-holdout-cv-result.v1\x00"
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_PATH_TEXT_LENGTH = 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CAPTURE_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)

PROTOCOL_KEYS = {
    "schemaVersion",
    "status",
    "authority",
    "globallyPristine",
    "roomLabel",
    "methodScope",
    "scanIds",
    "candidateIds",
    "referenceFaceName",
    "comparison",
    "repeatPolicy",
    "referenceJpegs",
    "scoringDependency",
    "wrapper",
    "cameraBuilder",
    "extractor",
    "cameraReceipt",
    "sourceE57",
    "candidateSourceProfiles",
    "sourceAssetVerificationBeforeCapture",
    "transformHoldoutEvaluator",
    "transformHoldoutReceipt",
    "viewerCode",
    "decisionRule",
    "priorUseDisclosure",
    "permissions",
    "protocolDigest",
}


class FileSnapshot(NamedTuple):
    path: Path
    payload: bytes
    size_bytes: int
    mtime_ns: int
    device: int
    inode: int
    sha256: str


class SourceAssetSnapshot(NamedTuple):
    path: Path
    size_bytes: int
    mtime_ns: int
    device: int
    inode: int
    sha256: str


def fail(code: str, message: str) -> None:
    raise ComparisonError(code, message)


def _canonical_json_bytes(value: Any) -> bytes:
    return BASE._canonical_json_bytes(value)


def _sha256_bytes(value: bytes) -> str:
    return BASE._sha256_bytes(value)


def _exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("INVALID_OBJECT", f"{label} must be a JSON object")
    actual = set(value)
    if actual != keys:
        fail(
            "INVALID_OBJECT_KEYS",
            f"{label} has the wrong fields; missing={sorted(keys-actual)}, "
            f"unexpected={sorted(actual-keys)}",
        )
    return value


def _require_exact(value: Any, expected: Any, label: str) -> None:
    if value != expected or type(value) is not type(expected):
        fail("FROZEN_VALUE_MISMATCH", f"{label} must be exactly {expected!r}")


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        fail("INVALID_SHA256", f"{label} must be exactly 64 lowercase hexadecimal characters")
    return value


def _is_link_or_reparse(stat_result: os.stat_result) -> bool:
    attributes = getattr(stat_result, "st_file_attributes", 0)
    reparse_flag = getattr(stat_module, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return stat_module.S_ISLNK(stat_result.st_mode) or bool(attributes & reparse_flag)


def _absolute_lexical(path: Path) -> Path:
    return Path(os.path.abspath(path))


def _require_no_link_components(path: Path, label: str, *, leaf_may_be_missing: bool = False) -> None:
    absolute = _absolute_lexical(path)
    components = absolute.parts
    if not components:
        fail("INVALID_PATH", f"{label} has no filesystem components")
    current = Path(components[0])
    for index, component in enumerate(components[1:], start=1):
        current /= component
        try:
            status = os.lstat(current)
        except FileNotFoundError:
            if leaf_may_be_missing and index == len(components) - 1:
                break
            fail("PATH_NOT_READABLE", f"{label} cannot be checked: path does not exist")
        except OSError as error:
            fail("PATH_NOT_READABLE", f"{label} cannot be checked: {error}")
        if _is_link_or_reparse(status):
            fail("SYMLINK_OR_REPARSE_FORBIDDEN", f"{label} contains a link or reparse point")


def _snapshot_file(path: Path, label: str, *, maximum_bytes: int | None = None) -> FileSnapshot:
    _require_no_link_components(path, label)
    try:
        resolved = path.resolve(strict=True)
        before = resolved.stat()
        payload = resolved.read_bytes()
        after = resolved.stat()
    except (OSError, RuntimeError) as error:
        fail("FILE_NOT_READABLE", f"{label} cannot be read: {error}")
    if not stat_module.S_ISREG(before.st_mode):
        fail("NOT_REGULAR_FILE", f"{label} must be a regular file")
    if before.st_size <= 0:
        fail("EMPTY_FILE", f"{label} must not be empty")
    if maximum_bytes is not None and before.st_size > maximum_bytes:
        fail("FILE_TOO_LARGE", f"{label} exceeds the {maximum_bytes}-byte limit")
    identity_before = (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    )
    identity_after = (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    )
    if identity_before != identity_after or len(payload) != before.st_size:
        fail("FILE_CHANGED_DURING_READ", f"{label} changed while it was read")
    return FileSnapshot(
        path=resolved,
        payload=payload,
        size_bytes=before.st_size,
        mtime_ns=before.st_mtime_ns,
        device=before.st_dev,
        inode=before.st_ino,
        sha256=_sha256_bytes(payload),
    )


def _verify_snapshot(snapshot: FileSnapshot, label: str) -> None:
    current = _snapshot_file(snapshot.path, label, maximum_bytes=max(snapshot.size_bytes, 1))
    if (
        current.size_bytes != snapshot.size_bytes
        or current.mtime_ns != snapshot.mtime_ns
        or current.device != snapshot.device
        or current.inode != snapshot.inode
        or current.sha256 != snapshot.sha256
    ):
        fail("FILE_CHANGED_AFTER_USE", f"{label} changed during this operation")


def _decode_json(snapshot: FileSnapshot, label: str) -> dict[str, Any]:
    try:
        decoded = json.loads(
            snapshot.payload.decode("utf-8"), object_pairs_hook=BASE._unique_object
        )
    except ComparisonError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("INVALID_JSON", f"{label} is not valid UTF-8 JSON: {error}")
    if not isinstance(decoded, dict):
        fail("INVALID_JSON", f"{label} root must be a JSON object")
    return decoded


def _read_json(path: Path, label: str) -> tuple[dict[str, Any], FileSnapshot]:
    snapshot = _snapshot_file(path, label, maximum_bytes=MAX_JSON_BYTES)
    return _decode_json(snapshot, label), snapshot


def _require_relative_path_text(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or value != value.strip()
        or not value
        or len(value) > MAX_PATH_TEXT_LENGTH
        or "\x00" in value
    ):
        fail("INVALID_PATH", f"{label} must be a non-empty, trimmed relative path")
    candidate = Path(value)
    if candidate.is_absolute() or candidate.drive or ".." in candidate.parts:
        fail("PATH_ESCAPE_FORBIDDEN", f"{label} must stay inside its declared directory")
    return value


def _code_entry(value: Any, expected_relative_path: str, label: str) -> dict[str, str]:
    entry = _exact_object(value, {"relativePath", "sha256"}, label)
    _require_exact(entry["relativePath"], expected_relative_path, f"{label}.relativePath")
    digest = _require_sha256(entry["sha256"], f"{label}.sha256")
    return {"relativePath": expected_relative_path, "sha256": digest}


def _code_snapshot(entry: dict[str, str], label: str) -> FileSnapshot:
    path = REPOSITORY_ROOT / entry["relativePath"]
    snapshot = _snapshot_file(path, label, maximum_bytes=4 * 1024 * 1024)
    if snapshot.sha256 != entry["sha256"]:
        fail(
            "CODE_HASH_MISMATCH",
            f"{label} changed: protocol says {entry['sha256']}, current file is {snapshot.sha256}",
        )
    return snapshot


def _validate_reference_jpegs(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) != len(SCAN_IDS):
        fail("REFERENCE_SET_MISMATCH", "referenceJpegs must contain exactly three rows")
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        row = _exact_object(
            item,
            {"scanId", "faceName", "width", "height", "sizeBytes", "sha256"},
            f"referenceJpegs[{index}]",
        )
        scan_id = SCAN_IDS[index]
        expected = EXPECTED_REFERENCE_JPEGS[scan_id]
        _require_exact(row, expected, f"referenceJpegs[{index}]")
        rows.append(copy.deepcopy(row))
    return rows


def _validate_candidate_source_profiles(value: Any) -> dict[str, Any]:
    profiles = _exact_object(value, set(CANDIDATE_IDS), "candidateSourceProfiles")
    for candidate_id in CANDIDATE_IDS:
        profile = _exact_object(
            profiles[candidate_id],
            {"profileId", "expectedGaussianCount", "assets"},
            f"candidateSourceProfiles.{candidate_id}",
        )
        assets = profile["assets"]
        if not isinstance(assets, list):
            fail(
                "INVALID_SOURCE_PROFILE",
                f"candidateSourceProfiles.{candidate_id}.assets must be an ordered array",
            )
        for index, asset in enumerate(assets):
            _exact_object(
                asset,
                {"fileName", "path", "url", "sizeBytes", "sha256"},
                f"candidateSourceProfiles.{candidate_id}.assets[{index}]",
            )
        _require_exact(
            profile,
            EXPECTED_CANDIDATE_SOURCE_PROFILES[candidate_id],
            f"candidateSourceProfiles.{candidate_id}",
        )
    return copy.deepcopy(profiles)


def _expected_source_asset_verification_entry(
    candidate_id: str, profile: dict[str, Any], asset: dict[str, Any]
) -> dict[str, Any]:
    return {
        "candidateId": candidate_id,
        "profileId": profile["profileId"],
        "fileName": asset["fileName"],
        "path": asset["path"],
        "url": asset["url"],
        "expectedSizeBytes": asset["sizeBytes"],
        "expectedSha256": asset["sha256"],
        "disk": {
            "sizeBytes": asset["sizeBytes"],
            "sha256": asset["sha256"],
        },
        "httpResponse": {
            "statusCode": 200,
            "sizeBytes": asset["sizeBytes"],
            "sha256": asset["sha256"],
            "redirected": False,
            "contentEncoding": "identity",
        },
    }


def _expected_source_asset_verification(phase: str) -> dict[str, Any]:
    assets = []
    for candidate_id in CANDIDATE_IDS:
        profile = EXPECTED_CANDIDATE_SOURCE_PROFILES[candidate_id]
        for asset in profile["assets"]:
            assets.append(
                _expected_source_asset_verification_entry(candidate_id, profile, asset)
            )
    return {
        "phase": phase,
        "method": SOURCE_ASSET_VERIFICATION_METHOD,
        "loopbackOnly": True,
        "redirectsAllowed": False,
        "assets": assets,
    }


def _validate_source_asset_verification(value: Any, phase: str, label: str) -> None:
    verification = _exact_object(
        value,
        {"phase", "method", "loopbackOnly", "redirectsAllowed", "assets"},
        label,
    )
    assets = verification["assets"]
    if not isinstance(assets, list) or len(assets) != 8:
        fail("SOURCE_ASSET_SET_MISMATCH", f"{label}.assets must contain exactly eight rows")
    for index, entry in enumerate(assets):
        row = _exact_object(
            entry,
            {
                "candidateId",
                "profileId",
                "fileName",
                "path",
                "url",
                "expectedSizeBytes",
                "expectedSha256",
                "disk",
                "httpResponse",
            },
            f"{label}.assets[{index}]",
        )
        _exact_object(row["disk"], {"sizeBytes", "sha256"}, f"{label}.assets[{index}].disk")
        _exact_object(
            row["httpResponse"],
            {"statusCode", "sizeBytes", "sha256", "redirected", "contentEncoding"},
            f"{label}.assets[{index}].httpResponse",
        )
    _require_exact(verification, _expected_source_asset_verification(phase), label)


def _stream_hash_source_file(
    path_text: str, expected_size: int, label: str
) -> SourceAssetSnapshot:
    path = Path(path_text)
    if not path.is_absolute():
        fail("SOURCE_ASSET_PATH_NOT_ABSOLUTE", f"{label} path must be absolute")
    _require_no_link_components(path, label)
    try:
        resolved = path.resolve(strict=True)
        digest = hashlib.sha256()
        with resolved.open("rb") as stream:
            before = os.fstat(stream.fileno())
            if not stat_module.S_ISREG(before.st_mode):
                fail("NOT_REGULAR_FILE", f"{label} must be a regular file")
            if before.st_size != expected_size:
                fail(
                    "SOURCE_ASSET_SIZE_MISMATCH",
                    f"{label} is {before.st_size} bytes; expected exactly {expected_size}",
                )
            total = 0
            while True:
                chunk = stream.read(min(SOURCE_HASH_CHUNK_BYTES, expected_size - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > expected_size:
                    fail("SOURCE_ASSET_TOO_LARGE", f"{label} exceeds its declared size")
                digest.update(chunk)
            after = os.fstat(stream.fileno())
        current = resolved.stat()
    except ComparisonError:
        raise
    except (OSError, RuntimeError) as error:
        fail("SOURCE_ASSET_NOT_READABLE", f"{label} cannot be stream-hashed: {error}")
    before_identity = (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    )
    after_identity = (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    )
    current_identity = (
        current.st_dev,
        current.st_ino,
        current.st_size,
        current.st_mtime_ns,
    )
    if before_identity != after_identity or after_identity != current_identity:
        fail("SOURCE_ASSET_CHANGED_DURING_READ", f"{label} changed while it was hashed")
    if total != expected_size:
        fail(
            "SOURCE_ASSET_SIZE_MISMATCH",
            f"{label} yielded {total} bytes; expected exactly {expected_size}",
        )
    return SourceAssetSnapshot(
        path=resolved,
        size_bytes=total,
        mtime_ns=after.st_mtime_ns,
        device=after.st_dev,
        inode=after.st_ino,
        sha256=digest.hexdigest(),
    )


def _stream_hash_loopback_http(
    url: str, expected_size: int, label: str
) -> tuple[int, str, int]:
    parsed = urlsplit(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or parsed.port not in {4174, 5175}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith("/")
    ):
        fail("SOURCE_HTTP_URL_FORBIDDEN", f"{label} must use an exact approved loopback URL")
    connection = http.client.HTTPConnection(
        "127.0.0.1", parsed.port, timeout=SOURCE_HTTP_TIMEOUT_SECONDS
    )
    try:
        connection.request(
            "GET",
            parsed.path,
            headers={
                "Accept-Encoding": "identity",
                "Cache-Control": "no-cache",
                "Connection": "close",
            },
        )
        response = connection.getresponse()
        if response.status != 200:
            fail(
                "SOURCE_HTTP_STATUS_MISMATCH",
                f"{label} returned HTTP {response.status}; redirects and non-200 responses are forbidden",
            )
        content_encoding = response.getheader("Content-Encoding")
        if content_encoding not in (None, "identity"):
            fail("SOURCE_HTTP_ENCODING_FORBIDDEN", f"{label} must return identity bytes")
        if response.getheader("Content-Range") is not None:
            fail("SOURCE_HTTP_PARTIAL_RESPONSE", f"{label} must return a complete response")
        content_length_text = response.getheader("Content-Length")
        if content_length_text is not None:
            try:
                content_length = int(content_length_text, 10)
            except ValueError:
                fail("SOURCE_HTTP_LENGTH_INVALID", f"{label} has an invalid Content-Length")
            if content_length != expected_size:
                fail(
                    "SOURCE_HTTP_LENGTH_MISMATCH",
                    f"{label} declares {content_length} bytes; expected exactly {expected_size}",
                )
        digest = hashlib.sha256()
        total = 0
        while True:
            chunk = response.read(min(SOURCE_HASH_CHUNK_BYTES, expected_size - total + 1))
            if not chunk:
                break
            total += len(chunk)
            if total > expected_size:
                fail("SOURCE_HTTP_RESPONSE_TOO_LARGE", f"{label} exceeds its declared size")
            digest.update(chunk)
    except ComparisonError:
        raise
    except (OSError, http.client.HTTPException) as error:
        fail("SOURCE_HTTP_NOT_READABLE", f"{label} cannot be stream-hashed: {error}")
    finally:
        connection.close()
    if total != expected_size:
        fail(
            "SOURCE_HTTP_LENGTH_MISMATCH",
            f"{label} yielded {total} bytes; expected exactly {expected_size}",
        )
    return total, digest.hexdigest(), 200


def _verify_candidate_source_assets(
    phase: str,
) -> tuple[dict[str, Any], dict[str, SourceAssetSnapshot]]:
    evidence = _expected_source_asset_verification(phase)
    snapshots: dict[str, SourceAssetSnapshot] = {}
    for candidate_id in CANDIDATE_IDS:
        profile = EXPECTED_CANDIDATE_SOURCE_PROFILES[candidate_id]
        for asset in profile["assets"]:
            label = f"{phase} {candidate_id} source {asset['fileName']}"
            snapshot = _stream_hash_source_file(asset["path"], asset["sizeBytes"], label)
            if snapshot.sha256 != asset["sha256"]:
                fail("SOURCE_ASSET_HASH_MISMATCH", f"{label} disk SHA-256 is not the frozen value")
            http_size, http_sha256, status_code = _stream_hash_loopback_http(
                asset["url"], asset["sizeBytes"], f"{label} HTTP response"
            )
            if http_sha256 != asset["sha256"]:
                fail("SOURCE_HTTP_HASH_MISMATCH", f"{label} HTTP SHA-256 is not the frozen value")
            if http_size != snapshot.size_bytes or http_sha256 != snapshot.sha256:
                fail("SOURCE_DISK_HTTP_MISMATCH", f"{label} disk and HTTP bytes differ")
            if status_code != 200:
                fail("SOURCE_HTTP_STATUS_MISMATCH", f"{label} did not return HTTP 200")
            snapshots[f"{candidate_id}:{asset['fileName']}"] = snapshot
    _validate_source_asset_verification(evidence, phase, f"{phase} source verification")
    return evidence, snapshots


def _verify_source_asset_snapshot(snapshot: SourceAssetSnapshot, label: str) -> None:
    current = _stream_hash_source_file(str(snapshot.path), snapshot.size_bytes, label)
    if current != snapshot:
        fail("SOURCE_ASSET_CHANGED_AFTER_VERIFICATION", f"{label} changed during this operation")


def _validate_receipt_descriptor(
    value: Any,
    label: str,
    *,
    expected_path: str,
    expected_schema: str,
    expected_sha256: str | None = None,
    expected_receipt_sha256: str | None = None,
) -> dict[str, str]:
    receipt = _exact_object(
        value, {"path", "sha256", "receiptSha256", "schemaVersion"}, label
    )
    _require_exact(receipt["path"], expected_path, f"{label}.path")
    _require_exact(receipt["schemaVersion"], expected_schema, f"{label}.schemaVersion")
    file_digest = _require_sha256(receipt["sha256"], f"{label}.sha256")
    receipt_digest = _require_sha256(
        receipt["receiptSha256"], f"{label}.receiptSha256"
    )
    if expected_sha256 is None and len(set(file_digest)) == 1:
        fail("PLACEHOLDER_SHA256", f"{label}.sha256 looks like a placeholder")
    if expected_receipt_sha256 is None and len(set(receipt_digest)) == 1:
        fail("PLACEHOLDER_SHA256", f"{label}.receiptSha256 looks like a placeholder")
    if file_digest == receipt_digest:
        fail(
            "RECEIPT_HASH_COLLISION",
            f"{label}.sha256 and {label}.receiptSha256 must identify different byte domains",
        )
    if expected_sha256 is not None:
        _require_exact(file_digest, expected_sha256, f"{label}.sha256")
    if expected_receipt_sha256 is not None:
        _require_exact(
            receipt_digest, expected_receipt_sha256, f"{label}.receiptSha256"
        )
    return copy.deepcopy(receipt)


def _validate_protocol_digest(document: dict[str, Any]) -> None:
    digest = _exact_object(
        document["protocolDigest"],
        {
            "algorithm",
            "domain",
            "sha256",
            "isSignature",
            "authenticatesCreator",
            "provesTimestamp",
        },
        "protocolDigest",
    )
    _require_exact(digest["algorithm"], "SHA-256", "protocolDigest.algorithm")
    _require_exact(
        digest["domain"],
        PROTOCOL_DIGEST_DOMAIN[:-1].decode("ascii"),
        "protocolDigest.domain",
    )
    _require_exact(digest["isSignature"], False, "protocolDigest.isSignature")
    _require_exact(
        digest["authenticatesCreator"], False, "protocolDigest.authenticatesCreator"
    )
    _require_exact(digest["provesTimestamp"], False, "protocolDigest.provesTimestamp")
    claimed = _require_sha256(digest["sha256"], "protocolDigest.sha256")
    unsigned = copy.deepcopy(document)
    unsigned.pop("protocolDigest")
    expected = _sha256_bytes(PROTOCOL_DIGEST_DOMAIN + _canonical_json_bytes(unsigned))
    if claimed != expected:
        fail(
            "PROTOCOL_DIGEST_MISMATCH",
            "protocol self-digest does not match its frozen fields",
        )


def _validate_protocol_identity(document: dict[str, Any]) -> None:
    _require_exact(
        document["schemaVersion"], PROTOCOL_SCHEMA_VERSION, "protocol.schemaVersion"
    )
    _require_exact(document["status"], PROTOCOL_STATUS, "protocol.status")
    _require_exact(document["authority"], AUTHORITY, "protocol.authority")
    _require_exact(
        document["globallyPristine"], False, "protocol.globallyPristine"
    )
    _require_exact(document["roomLabel"], ROOM_LABEL, "protocol.roomLabel")
    _require_exact(document["methodScope"], METHOD_SCOPE, "protocol.methodScope")
    _require_exact(document["scanIds"], list(SCAN_IDS), "protocol.scanIds")
    _require_exact(
        document["candidateIds"], list(CANDIDATE_IDS), "protocol.candidateIds"
    )
    _require_exact(
        document["referenceFaceName"],
        REFERENCE_FACE_NAME,
        "protocol.referenceFaceName",
    )


def _validate_protocol_method(document: dict[str, Any]) -> None:
    comparison = _exact_object(
        document["comparison"], {"width", "height", "borderPixels"}, "comparison"
    )
    _require_exact(comparison, EXPECTED_COMPARISON, "protocol.comparison")
    repeat_policy = _exact_object(
        document["repeatPolicy"],
        {"requiredScanId", "requiredCandidateIds", "repeatsForbiddenOnOtherScans"},
        "repeatPolicy",
    )
    _require_exact(
        repeat_policy,
        {
            "requiredScanId": 126,
            "requiredCandidateIds": list(CANDIDATE_IDS),
            "repeatsForbiddenOnOtherScans": True,
        },
        "protocol.repeatPolicy",
    )
    _validate_reference_jpegs(document["referenceJpegs"])


def _validate_viewer_code(value: Any) -> dict[str, dict[str, str]]:
    if not isinstance(value, list) or len(value) != len(VIEWER_CODE_RELATIVE_PATHS):
        fail(
            "VIEWER_CODE_SET_MISMATCH",
            "viewerCode must contain the exact 16-file live capture chain",
        )
    entries: dict[str, dict[str, str]] = {}
    for index, expected_path in enumerate(VIEWER_CODE_RELATIVE_PATHS):
        entry = _code_entry(value[index], expected_path, f"viewerCode[{index}]")
        entries[f"viewerCode:{expected_path}"] = entry
    return entries


def _validate_protocol_chain(document: dict[str, Any]) -> dict[str, dict[str, str]]:
    code_paths = {
        "scoringDependency": SCORING_DEPENDENCY_RELATIVE_PATH,
        "wrapper": WRAPPER_RELATIVE_PATH,
        "cameraBuilder": CAMERA_BUILDER_RELATIVE_PATH,
        "extractor": EXTRACTOR_RELATIVE_PATH,
        "transformHoldoutEvaluator": TRANSFORM_EVALUATOR_RELATIVE_PATH,
    }
    code_entries = {
        label: _code_entry(document[label], relative_path, label)
        for label, relative_path in code_paths.items()
    }
    code_entries.update(_validate_viewer_code(document["viewerCode"]))

    _validate_receipt_descriptor(
        document["cameraReceipt"],
        "cameraReceipt",
        expected_path=EXPECTED_CAMERA_RECEIPT["path"],
        expected_schema=EXPECTED_CAMERA_RECEIPT["schemaVersion"],
        expected_sha256=EXPECTED_CAMERA_RECEIPT["sha256"],
        expected_receipt_sha256=EXPECTED_CAMERA_RECEIPT["receiptSha256"],
    )

    source_e57 = _exact_object(
        document["sourceE57"], {"fileName", "sizeBytes", "sha256"}, "sourceE57"
    )
    _require_exact(source_e57, EXPECTED_SOURCE_E57, "protocol.sourceE57")
    _validate_candidate_source_profiles(document["candidateSourceProfiles"])
    _validate_receipt_descriptor(
        document["transformHoldoutReceipt"],
        "transformHoldoutReceipt",
        expected_path=EXPECTED_TRANSFORM_RECEIPT["path"],
        expected_schema=EXPECTED_TRANSFORM_RECEIPT["schemaVersion"],
        expected_sha256=EXPECTED_TRANSFORM_RECEIPT["sha256"],
        expected_receipt_sha256=EXPECTED_TRANSFORM_RECEIPT["receiptSha256"],
    )
    _require_exact(
        document["decisionRule"], DECISION_RULE, "protocol.decisionRule"
    )
    return code_entries


def _validate_protocol_disclosures(document: dict[str, Any]) -> None:
    prior_use = _exact_object(
        document["priorUseDisclosure"],
        {
            "globallyPristine",
            "july14ImageEvidencePreviouslyUsed",
            "july14GeometryEvidencePreviouslyUsed",
            "statement",
        },
        "priorUseDisclosure",
    )
    _require_exact(
        prior_use,
        {
            "globallyPristine": False,
            "july14ImageEvidencePreviouslyUsed": True,
            "july14GeometryEvidencePreviouslyUsed": True,
            "statement": (
                "Scans 126, 129, and 141 appeared in July 14 image and geometry "
                "diagnostics; they are held out only from this matched-render "
                "comparison method."
            ),
        },
        "protocol.priorUseDisclosure",
    )
    permissions = _exact_object(
        document["permissions"],
        {
            "physicalApproval",
            "runtimePromotionApproval",
            "publicReleaseApproval",
            "trainingApproval",
        },
        "permissions",
    )
    _require_exact(
        permissions,
        {
            "physicalApproval": False,
            "runtimePromotionApproval": False,
            "publicReleaseApproval": False,
            "trainingApproval": False,
        },
        "protocol.permissions",
    )


def _validate_protocol_values(
    document: dict[str, Any], *, require_digest: bool
) -> dict[str, dict[str, str]]:
    expected_keys = (
        PROTOCOL_KEYS
        if require_digest
        else PROTOCOL_KEYS
        - {"protocolDigest", "sourceAssetVerificationBeforeCapture"}
    )
    _exact_object(document, expected_keys, "protocol")
    _validate_protocol_identity(document)
    _validate_protocol_method(document)
    code_entries = _validate_protocol_chain(document)
    _validate_protocol_disclosures(document)
    if require_digest:
        _validate_source_asset_verification(
            document["sourceAssetVerificationBeforeCapture"],
            "before_capture",
            "protocol.sourceAssetVerificationBeforeCapture",
        )
        _validate_protocol_digest(document)
    return code_entries


def validate_protocol(
    document: dict[str, Any], *, require_digest: bool = True, verify_code: bool = True
) -> dict[str, FileSnapshot]:
    entries = _validate_protocol_values(document, require_digest=require_digest)
    if not verify_code:
        return {}
    snapshots = {
        label: _code_snapshot(entry, label) for label, entry in entries.items()
    }
    scorer_digest = entries["scoringDependency"]["sha256"]
    if scorer_digest != IMPORTED_SCORING_DEPENDENCY_SHA256:
        fail(
            "IMPORTED_SCORER_HASH_MISMATCH",
            "the imported scoring implementation is not the version frozen in the protocol",
        )
    if entries["wrapper"]["sha256"] != IMPORTED_WRAPPER_SHA256:
        fail(
            "IMPORTED_WRAPPER_HASH_MISMATCH",
            "the running wrapper is not the version frozen in the protocol",
        )
    return snapshots


def _seal_protocol(draft: dict[str, Any]) -> dict[str, Any]:
    sealed = copy.deepcopy(draft)
    digest = _sha256_bytes(PROTOCOL_DIGEST_DOMAIN + _canonical_json_bytes(sealed))
    sealed["protocolDigest"] = {
        "algorithm": "SHA-256",
        "domain": PROTOCOL_DIGEST_DOMAIN[:-1].decode("ascii"),
        "sha256": digest,
        "isSignature": False,
        "authenticatesCreator": False,
        "provesTimestamp": False,
    }
    return sealed


def _prepare_output(path: Path, label: str) -> Path:
    if path.suffix.casefold() != ".json":
        fail("OUTPUT_EXTENSION", f"{label} must end in .json")
    absolute = _absolute_lexical(path)
    _require_no_link_components(absolute.parent, f"{label} parent")
    if not absolute.parent.is_dir():
        fail("OUTPUT_PARENT_MISSING", f"{label} parent directory must already exist")
    _require_no_link_components(absolute, label, leaf_may_be_missing=True)
    if absolute.exists():
        fail("OUTPUT_EXISTS", f"{label} already exists; outputs are create-only")
    return absolute


def _write_create_only_json(path: Path, document: dict[str, Any], label: str) -> Path:
    target = _prepare_output(path, label)
    payload = (
        json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
        + "\n"
    ).encode("utf-8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    try:
        descriptor = os.open(target, flags, 0o600)
    except FileExistsError:
        fail("OUTPUT_EXISTS", f"{label} already exists; outputs are create-only")
    except OSError as error:
        fail("OUTPUT_NOT_WRITABLE", f"{label} cannot be created: {error}")
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.chmod(target, 0o600)
        except OSError as error:
            target.unlink(missing_ok=True)
            fail("OUTPUT_PRIVACY_MODE_FAILED", f"private file mode could not be set: {error}")
    except ComparisonError:
        raise
    except OSError as error:
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
        fail("OUTPUT_WRITE_FAILED", f"{label} could not be finished: {error}")
    return target


def freeze_protocol(draft: Path, output: Path) -> dict[str, Any]:
    draft_document, draft_snapshot = _read_json(Path(draft), "protocol draft")
    code_snapshots = validate_protocol(
        draft_document, require_digest=False, verify_code=True
    )
    target = _prepare_output(Path(output), "frozen protocol")
    before_verification, source_snapshots = _verify_candidate_source_assets(
        "before_capture"
    )
    protected = {
        draft_snapshot.path,
        *(item.path for item in code_snapshots.values()),
        *(item.path for item in source_snapshots.values()),
    }
    if target.resolve(strict=False) in protected:
        fail("OUTPUT_OVERLAPS_INPUT", "frozen protocol output overlaps a protected input")
    protocol_body = copy.deepcopy(draft_document)
    protocol_body["sourceAssetVerificationBeforeCapture"] = before_verification
    sealed = _seal_protocol(protocol_body)
    validate_protocol(sealed, require_digest=True, verify_code=False)
    _verify_snapshot(draft_snapshot, "protocol draft")
    for label, snapshot in code_snapshots.items():
        _verify_snapshot(snapshot, label)
    for label, snapshot in source_snapshots.items():
        _verify_source_asset_snapshot(snapshot, f"before_capture source {label}")
    _write_create_only_json(target, sealed, "frozen protocol")
    return sealed


def _review_view_id(scan_id: int) -> str:
    return f"experimental-e57:e57-method-holdout-scan-{scan_id}-skybox-4"


def expected_capture_url(scan_id: int, candidate_id: str) -> str:
    camera = CAPTURE_CAMERA_PARAMETERS[scan_id]
    query = urlencode(
        [
            ("candidate", candidate_id),
            ("camera", camera["camera"]),
            ("lookAt", camera["lookAt"]),
            ("up", camera["up"]),
            ("fov", "90"),
            (
                "experimentalViewId",
                f"e57-method-holdout-scan-{scan_id}-skybox-4",
            ),
            ("capture", "1"),
        ]
    )
    return f"{CAPTURE_ORIGIN}{CAPTURE_ROUTE}?{query}"


def _validate_capture_scene(
    value: Any, expected_count: int, review_view_id: str, label: str
) -> None:
    scene = _exact_object(
        value,
        {
            "sceneState",
            "cameraReady",
            "loadedSourceCount",
            "loadedSplatCount",
            "renderProfileId",
            "reviewViewId",
            "effectiveDpr",
        },
        label,
    )
    expected_scene = {
        "sceneState": "live",
        "cameraReady": True,
        "loadedSourceCount": 4,
        "loadedSplatCount": expected_count,
        "renderProfileId": RENDER_PROFILE_ID,
        "reviewViewId": review_view_id,
    }
    for key, expected in expected_scene.items():
        _require_exact(scene[key], expected, f"{label}.{key}")
    effective_dpr = scene["effectiveDpr"]
    if (
        isinstance(effective_dpr, bool)
        or not isinstance(effective_dpr, (int, float))
        or abs(float(effective_dpr) - 1.0) > 1e-6
    ):
        fail("CAPTURE_DPR_MISMATCH", f"{label}.effectiveDpr must be approximately 1")


def _validate_capture_root(
    value: Any,
    candidate_id: str,
    profile_id: str,
    expected_count: int,
    review_view_id: str,
    label: str,
) -> None:
    root = _exact_object(
        value,
        {"candidateId", "runtimeProfileId", "expectedSplatCount", "reviewViewId"},
        label,
    )
    expected = {
        "candidateId": candidate_id,
        "runtimeProfileId": profile_id,
        "expectedSplatCount": expected_count,
        "reviewViewId": review_view_id,
    }
    for key, expected_value in expected.items():
        _require_exact(root[key], expected_value, f"{label}.{key}")


def _validate_capture_canvas(value: Any, label: str) -> None:
    canvas = _exact_object(
        value, {"width", "height", "clientWidth", "clientHeight"}, label
    )
    _require_exact(
        canvas,
        {"width": 1024, "height": 1024, "clientWidth": 1024, "clientHeight": 1024},
        label,
    )


def _validate_capture_evidence(
    value: Any, scan_id: int, candidate_id: str, role: str, label: str
) -> dict[str, Any]:
    evidence = _exact_object(
        value,
        {
            "url",
            "captureOrdinal",
            "captureId",
            "viewportMethod",
            "browserMethod",
            "scene",
            "root",
            "canvas",
        },
        label,
    )
    _require_exact(
        evidence["url"], expected_capture_url(scan_id, candidate_id), f"{label}.url"
    )
    _require_exact(
        evidence["captureOrdinal"],
        CAPTURE_ORDINALS[(scan_id, candidate_id, role)],
        f"{label}.captureOrdinal",
    )
    capture_id = evidence["captureId"]
    if not isinstance(capture_id, str) or CAPTURE_ID_RE.fullmatch(capture_id) is None:
        fail(
            "INVALID_CAPTURE_ID",
            f"{label}.captureId must be a lowercase UUIDv4 created for this capture",
        )
    _require_exact(
        evidence["viewportMethod"],
        CAPTURE_VIEWPORT_METHOD,
        f"{label}.viewportMethod",
    )
    _require_exact(
        evidence["browserMethod"], CAPTURE_BROWSER_METHOD, f"{label}.browserMethod"
    )
    expected_profile = EXPECTED_CANDIDATE_SOURCE_PROFILES[candidate_id]
    expected_count = expected_profile["expectedGaussianCount"]
    review_view_id = _review_view_id(scan_id)
    _validate_capture_scene(evidence["scene"], expected_count, review_view_id, f"{label}.scene")
    _validate_capture_root(
        evidence["root"],
        candidate_id,
        expected_profile["profileId"],
        expected_count,
        review_view_id,
        f"{label}.root",
    )
    _validate_capture_canvas(evidence["canvas"], f"{label}.canvas")
    return copy.deepcopy(evidence)


def _parse_image_binding(
    value: Any,
    label: str,
    capture_context: tuple[int, str, str] | None = None,
) -> dict[str, Any]:
    keys = {"path", "sha256"} if capture_context is None else {
        "path",
        "sha256",
        "captureEvidence",
    }
    binding = _exact_object(value, keys, label)
    path = _require_relative_path_text(binding["path"], f"{label}.path")
    digest = _require_sha256(binding["sha256"], f"{label}.sha256")
    parsed: dict[str, Any] = {"path": path, "sha256": digest}
    if capture_context is not None:
        scan_id, candidate_id, role = capture_context
        parsed["captureEvidence"] = _validate_capture_evidence(
            binding["captureEvidence"],
            scan_id,
            candidate_id,
            role,
            f"{label}.captureEvidence",
        )
    return parsed


def _parse_candidate_binding(
    value: Any, scan_id: int, candidate_id: str
) -> dict[str, Any]:
    label = f"scan {scan_id} candidate {candidate_id}"
    candidate = _exact_object(value, {"render", "repeat"}, label)
    render = _parse_image_binding(
        candidate["render"],
        f"{label}.render",
        (scan_id, candidate_id, "render"),
    )
    repeat_value = candidate["repeat"]
    if scan_id == 126:
        if repeat_value is None:
            fail("REPEAT_REQUIRED", f"{label}.repeat is required on scan 126")
        repeat = _parse_image_binding(
            repeat_value,
            f"{label}.repeat",
            (scan_id, candidate_id, "repeat"),
        )
    else:
        if repeat_value is not None:
            fail("REPEAT_FORBIDDEN", f"{label}.repeat must be null on scans 129 and 141")
        repeat = None
    return {"render": render, "repeat": repeat}


def _parse_manifest_views(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) != len(SCAN_IDS):
        fail("HOLDOUT_SCAN_SET_MISMATCH", "views must contain exactly scans 126, 129, and 141")
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        view = _exact_object(item, {"scanId", "reference", "candidates"}, f"views[{index}]")
        scan_id = SCAN_IDS[index]
        _require_exact(view["scanId"], scan_id, f"views[{index}].scanId")
        candidates = _exact_object(
            view["candidates"], set(CANDIDATE_IDS), f"views[{index}].candidates"
        )
        reference = _parse_image_binding(
            view["reference"], f"scan {scan_id} reference"
        )
        expected_reference_hash = EXPECTED_REFERENCE_JPEGS[scan_id]["sha256"]
        _require_exact(
            reference["sha256"],
            expected_reference_hash,
            f"scan {scan_id} reference.sha256",
        )
        rows.append(
            {
                "scanId": scan_id,
                "reference": reference,
                "candidates": {
                    candidate_id: _parse_candidate_binding(
                        candidates[candidate_id], scan_id, candidate_id
                    )
                    for candidate_id in CANDIDATE_IDS
                },
            }
        )
    capture_ids = [
        binding["captureEvidence"]["captureId"]
        for row in rows
        for candidate_id in CANDIDATE_IDS
        for binding in (
            row["candidates"][candidate_id]["render"],
            row["candidates"][candidate_id]["repeat"],
        )
        if binding is not None
    ]
    if len(capture_ids) != len(set(capture_ids)):
        fail(
            "DUPLICATE_CAPTURE_ID",
            "every render and repeat must have a distinct captureId; copied IDs are forbidden",
        )
    return rows


def _validate_manifest(
    document: dict[str, Any],
    protocol_snapshot: FileSnapshot,
    manifest_parent: Path,
) -> list[dict[str, Any]]:
    manifest = _exact_object(
        document,
        {"schemaVersion", "authority", "captureEncoding", "protocol", "views"},
        "manifest",
    )
    _require_exact(
        manifest["schemaVersion"], MANIFEST_SCHEMA_VERSION, "manifest.schemaVersion"
    )
    _require_exact(manifest["authority"], AUTHORITY, "manifest.authority")
    _require_exact(
        manifest["captureEncoding"], CAPTURE_ENCODING, "manifest.captureEncoding"
    )
    protocol_binding = _exact_object(
        manifest["protocol"], {"path", "sha256"}, "manifest.protocol"
    )
    protocol_relative_path = _require_relative_path_text(
        protocol_binding["path"], "manifest.protocol.path"
    )
    protocol_declared_hash = _require_sha256(
        protocol_binding["sha256"], "manifest.protocol.sha256"
    )
    bound_protocol = _snapshot_file(
        manifest_parent / protocol_relative_path,
        "manifest-bound protocol",
        maximum_bytes=MAX_JSON_BYTES,
    )
    if (bound_protocol.device, bound_protocol.inode) != (
        protocol_snapshot.device,
        protocol_snapshot.inode,
    ):
        fail(
            "PROTOCOL_PATH_MISMATCH",
            "manifest.protocol.path does not name the --protocol file",
        )
    if protocol_declared_hash != protocol_snapshot.sha256:
        fail(
            "PROTOCOL_FILE_HASH_MISMATCH",
            "manifest.protocol.sha256 does not match the complete frozen protocol file",
        )
    return _parse_manifest_views(manifest["views"])


def _resolve_regular_file(path: Path, label: str) -> tuple[Path, os.stat_result]:
    _require_no_link_components(path, label)
    try:
        resolved = path.resolve(strict=True)
        status = resolved.stat()
    except (OSError, RuntimeError) as error:
        fail("FILE_NOT_READABLE", f"{label} cannot be opened: {error}")
    if not stat_module.S_ISREG(status.st_mode):
        fail("NOT_REGULAR_FILE", f"{label} must be a regular file")
    if status.st_size <= 0:
        fail("EMPTY_FILE", f"{label} must not be empty")
    return resolved, status


def _collect_image_paths(
    views: list[dict[str, Any]], manifest_parent: Path
) -> tuple[
    dict[tuple[int, str, str], Path],
    dict[tuple[int, str, str], str],
    dict[tuple[int, str, str], dict[str, Any]],
]:
    paths: dict[tuple[int, str, str], Path] = {}
    declared_hashes: dict[tuple[int, str, str], str] = {}
    capture_evidence: dict[tuple[int, str, str], dict[str, Any]] = {}
    seen_paths: dict[Path, str] = {}
    seen_identities: dict[tuple[int, int], str] = {}
    for view in views:
        scan_id = int(view["scanId"])
        bindings: list[tuple[str, str, dict[str, str]]] = [
            ("reference", "render", view["reference"])
        ]
        for candidate_id in CANDIDATE_IDS:
            candidate = view["candidates"][candidate_id]
            bindings.append((candidate_id, "render", candidate["render"]))
            if candidate["repeat"] is not None:
                bindings.append((candidate_id, "repeat", candidate["repeat"]))
        for owner, role, binding in bindings:
            key = (scan_id, owner, role)
            label = f"scan {scan_id} {owner} {role}"
            resolved, status = _resolve_regular_file(
                manifest_parent / binding["path"], label
            )
            identity = (status.st_dev, status.st_ino)
            if resolved in seen_paths:
                fail(
                    "DUPLICATE_INPUT_PATH",
                    f"{label} reuses the path already used by {seen_paths[resolved]}",
                )
            if identity in seen_identities:
                fail(
                    "DUPLICATE_INPUT_IDENTITY",
                    f"{label} is the same filesystem file as {seen_identities[identity]}",
                )
            seen_paths[resolved] = label
            seen_identities[identity] = label
            paths[key] = resolved
            declared_hashes[key] = binding["sha256"]
            if owner != "reference":
                capture_evidence[key] = copy.deepcopy(binding["captureEvidence"])
    return paths, declared_hashes, capture_evidence


def _validate_loaded_image(
    key: tuple[int, str, str],
    record: ImageRecord,
    declared_hash: str,
) -> None:
    scan_id, owner, role = key
    label = f"scan {scan_id} {owner} {role}"
    if record.sha256 != declared_hash:
        fail(
            "IMAGE_HASH_MISMATCH",
            f"{label} bytes do not match the SHA-256 declared in the manifest",
        )
    if record.image_format.casefold() != "jpeg":
        fail(
            "CAPTURE_ENCODING_MISMATCH",
            f"{label} must decode as JPEG for {CAPTURE_ENCODING}",
        )
    if owner == "reference":
        expected = EXPECTED_REFERENCE_JPEGS[scan_id]
        if (record.original_width, record.original_height) != (
            expected["width"],
            expected["height"],
        ):
            fail(
                "REFERENCE_DIMENSIONS_MISMATCH",
                f"{label} must be exactly {expected['width']}x{expected['height']}",
            )
        if record.size_bytes != expected["sizeBytes"]:
            fail(
                "REFERENCE_SIZE_MISMATCH",
                f"{label} must be exactly {expected['sizeBytes']} bytes",
            )
        if record.sha256 != expected["sha256"]:
            fail("REFERENCE_HASH_MISMATCH", f"{label} is not the audited Skybox 4 JPEG")
        return
    expected_dimensions = (
        EXPECTED_COMPARISON["width"],
        EXPECTED_COMPARISON["height"],
    )
    if (record.original_width, record.original_height) != expected_dimensions:
        fail(
            "CANDIDATE_DIMENSIONS_MISMATCH",
            f"{label} must be exactly {expected_dimensions[0]}x{expected_dimensions[1]}",
        )
    if record.evidence["resizeMethod"] != "identity":
        fail("CANDIDATE_RESIZE_FORBIDDEN", f"{label} must not be resized before scoring")


def _load_records(
    paths: dict[tuple[int, str, str], Path],
    declared_hashes: dict[tuple[int, str, str], str],
    capture_evidence: dict[tuple[int, str, str], dict[str, Any]],
) -> tuple[
    dict[tuple[int, str, str], ImageRecord],
    dict[tuple[int, str, str], dict[str, float]],
]:
    records: dict[tuple[int, str, str], ImageRecord] = {}
    blank_statistics: dict[tuple[int, str, str], dict[str, float]] = {}
    for key in sorted(paths):
        scan_id, owner, role = key
        label = f"scan {scan_id} {owner} {role}"
        record = BASE._load_rgb(
            paths[key],
            EXPECTED_COMPARISON["width"],
            EXPECTED_COMPARISON["height"],
            label,
        )
        _validate_loaded_image(key, record, declared_hashes[key])
        record.evidence["captureEncoding"] = CAPTURE_ENCODING
        if owner != "reference":
            record.evidence["captureEvidence"] = copy.deepcopy(capture_evidence[key])
        records[key] = record
        blank_statistics[key] = BASE._require_nonblank(
            BASE._to_gray(record.comparison_rgb), label
        )
    return records, blank_statistics


def _build_view_rows(
    records: dict[tuple[int, str, str], ImageRecord],
    blank_statistics: dict[tuple[int, str, str], dict[str, float]],
) -> tuple[list[dict[str, Any]], dict[str, float], dict[str, int], list[int]]:
    rows: list[dict[str, Any]] = []
    repeat_deviations = {metric_id: [] for metric_id in BASE.METRIC_IDS}
    repeat_counts = {candidate_id: 0 for candidate_id in CANDIDATE_IDS}
    common_repeat_scans: list[int] = []
    for scan_id in SCAN_IDS:
        reference = records[(scan_id, "reference", "render")]
        candidates: dict[str, Any] = {}
        both_repeat = True
        for candidate_id in CANDIDATE_IDS:
            entry, deviations = BASE._candidate_view_entry(
                scan_id,
                candidate_id,
                reference,
                records,
                blank_statistics,
                EXPECTED_COMPARISON["borderPixels"],
            )
            if deviations is None:
                both_repeat = False
            else:
                repeat_counts[candidate_id] += 1
                for metric_id in BASE.METRIC_IDS:
                    repeat_deviations[metric_id].append(deviations[metric_id])
            candidates[candidate_id] = entry
        if both_repeat:
            common_repeat_scans.append(scan_id)
        rows.append(
            {
                "scanId": scan_id,
                "reference": {
                    **reference.evidence,
                    "nonblankStatistics": blank_statistics[
                        (scan_id, "reference", "render")
                    ],
                },
                "candidates": candidates,
            }
        )
    repeat_noise = {
        metric_id: max(repeat_deviations[metric_id], default=0.0)
        for metric_id in BASE.METRIC_IDS
    }
    return rows, repeat_noise, repeat_counts, common_repeat_scans


class EvaluationContext(NamedTuple):
    document: dict[str, Any]
    protocol_snapshot: FileSnapshot
    manifest_snapshot: FileSnapshot
    code_snapshots: dict[str, FileSnapshot]
    source_asset_snapshots: dict[str, SourceAssetSnapshot]
    records: dict[tuple[int, str, str], ImageRecord]


class LoadedInputs(NamedTuple):
    protocol: dict[str, Any]
    protocol_snapshot: FileSnapshot
    manifest_snapshot: FileSnapshot
    code_snapshots: dict[str, FileSnapshot]
    source_asset_verification_after_capture: dict[str, Any]
    source_asset_snapshots: dict[str, SourceAssetSnapshot]
    records: dict[tuple[int, str, str], ImageRecord]
    blank_statistics: dict[tuple[int, str, str], dict[str, float]]


def _method_evidence(protocol: dict[str, Any]) -> dict[str, Any]:
    evidence = copy.deepcopy(BASE._method_evidence())
    evidence["implementationReuse"] = {
        "mode": "mechanical_import_no_metric_or_decision_copy",
        "dependencyRelativePath": SCORING_DEPENDENCY_RELATIVE_PATH,
        "dependencySha256": protocol["scoringDependency"]["sha256"],
        "reusedFunctions": [
            "_load_rgb",
            "_to_gray",
            "_require_nonblank",
            "_candidate_view_entry",
            "_apply_decision",
            "_verify_records_unchanged",
            "_method_evidence",
        ],
    }
    evidence["holdoutPolicy"] = {
        "scope": METHOD_SCOPE,
        "scanIds": list(SCAN_IDS),
        "referenceFaceName": REFERENCE_FACE_NAME,
        "comparison": copy.deepcopy(EXPECTED_COMPARISON),
        "repeatRequiredOnlyOnScanId": 126,
        "repeatForbiddenOnScanIds": [129, 141],
    }
    evidence["captureEncoding"] = {
        "id": CAPTURE_ENCODING,
        "format": "JPEG",
        "lossless": False,
        "plainLanguage": (
            "The in-app Browser screenshot is JPEG. This result does not describe "
            "candidate captures as lossless PNGs."
        ),
    }
    return evidence


def _safety_evidence() -> dict[str, Any]:
    return {
        "sourceMutationPermitted": False,
        "sourceMutationPerformed": False,
        "geometricRegistrationPermitted": False,
        "geometricRegistrationPerformed": False,
        "trainingPermitted": False,
        "trainingPerformed": False,
        "networkUsePermitted": True,
        "networkUsePerformed": True,
        "networkScope": "loopback HTTP only for source-byte verification",
        "externalNetworkUsePermitted": False,
        "externalNetworkUsePerformed": False,
        "contactSheetPermitted": False,
        "contactSheetCreated": False,
        "captureEvidenceCryptographicallyProvesIndependentAcquisition": False,
        "viewerCodePinsAreBuiltBundleAttestation": False,
        "outputPolicy": "one create-only private authority-none JSON result only",
        "metadataOnlyArtifactsNotOpened": [
            "cameraReceipt.path",
            "transformHoldoutReceipt.path",
            "sourceE57",
        ],
    }


def _limitations() -> list[str]:
    return [
        (
            "Scans 126, 129, and 141 appeared in July 14 image and geometry "
            "diagnostics. They are not globally pristine or globally unseen."
        ),
        (
            "They are held out only from this matched-render comparison method; "
            "the result must not be described as a globally pristine test."
        ),
        (
            "A structural JPEG comparison can be affected by camera, JPEG encoding, "
            "exposure, occlusion, or renderer behavior and does not prove physical accuracy."
        ),
        (
            "Repeat evidence comes only from scan 126 and estimates only the variation "
            "present in the supplied repeat captures."
        ),
        (
            "Distinct capture IDs, ordinals, URLs, and live DOM telemetry make copied or "
            "mislabelled repeats easier to detect, but they do not cryptographically prove "
            "that two JPEGs were acquired independently. Byte-identical repeats remain possible."
        ),
        (
            "The viewer source-file and lockfile hashes bind the declared live capture code "
            "chain, but they are not a cryptographic attestation of the exact built JavaScript "
            "served by the development server."
        ),
        (
            "The disk and loopback HTTP hashes prove the expected source bytes were present at "
            "the freeze and score checks. They do not cryptographically prove that the browser "
            "used that exact response for every frame; browser cache and runtime execution are "
            "separate facts."
        ),
        (
            "The directional rule has no calibrated practical-effect threshold, so it "
            "does not establish that a numerical lead is visibly or commercially material."
        ),
        (
            "The protocol and result self-digests detect unrecomputed edits; they are not "
            "signatures, trusted timestamps, rights grants, or truth certificates."
        ),
    ]


def _seal_result(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    digest = _sha256_bytes(RESULT_DIGEST_DOMAIN + _canonical_json_bytes(unsigned))
    sealed = copy.deepcopy(unsigned)
    sealed["receipt"] = {
        "algorithm": "SHA-256",
        "domain": RESULT_DIGEST_DOMAIN[:-1].decode("ascii"),
        "sha256": digest,
        "isSignature": False,
        "authenticatesCreator": False,
        "provesTimestamp": False,
        "control": "this wrapper's complete result document excluding receipt",
        "wrapperSha256": unsigned["inputEvidence"]["code"]["wrapper"]["sha256"],
        "scoringDependencySha256": unsigned["inputEvidence"]["code"]
        ["scoringDependency"]["sha256"],
    }
    return sealed


def verify_result_receipt(document: dict[str, Any]) -> None:
    receipt = _exact_object(
        document.get("receipt"),
        {
            "algorithm",
            "domain",
            "sha256",
            "isSignature",
            "authenticatesCreator",
            "provesTimestamp",
            "control",
            "wrapperSha256",
            "scoringDependencySha256",
        },
        "receipt",
    )
    _require_exact(receipt["algorithm"], "SHA-256", "receipt.algorithm")
    _require_exact(
        receipt["domain"], RESULT_DIGEST_DOMAIN[:-1].decode("ascii"), "receipt.domain"
    )
    for key in ("isSignature", "authenticatesCreator", "provesTimestamp"):
        _require_exact(receipt[key], False, f"receipt.{key}")
    _require_exact(
        receipt["control"],
        "this wrapper's complete result document excluding receipt",
        "receipt.control",
    )
    _require_sha256(receipt["wrapperSha256"], "receipt.wrapperSha256")
    _require_sha256(
        receipt["scoringDependencySha256"], "receipt.scoringDependencySha256"
    )
    claimed = _require_sha256(receipt["sha256"], "receipt.sha256")
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt")
    expected = _sha256_bytes(RESULT_DIGEST_DOMAIN + _canonical_json_bytes(unsigned))
    if claimed != expected:
        fail("RESULT_DIGEST_MISMATCH", "result self-digest does not match the result fields")
    _require_exact(
        receipt["wrapperSha256"],
        unsigned["inputEvidence"]["code"]["wrapper"]["sha256"],
        "receipt.wrapperSha256",
    )
    _require_exact(
        receipt["scoringDependencySha256"],
        unsigned["inputEvidence"]["code"]["scoringDependency"]["sha256"],
        "receipt.scoringDependencySha256",
    )


def _verify_evaluation_inputs(context: EvaluationContext) -> None:
    BASE._verify_records_unchanged(context.records)
    _verify_snapshot(context.protocol_snapshot, "frozen protocol")
    _verify_snapshot(context.manifest_snapshot, "input manifest")
    for label, snapshot in context.code_snapshots.items():
        _verify_snapshot(snapshot, label)
    for label, snapshot in context.source_asset_snapshots.items():
        _verify_source_asset_snapshot(snapshot, f"after_capture source {label}")


def _reject_input_identity_overlap(
    manifest_snapshot: FileSnapshot,
    protocol_snapshot: FileSnapshot,
    code_snapshots: dict[str, FileSnapshot],
    source_asset_snapshots: dict[str, SourceAssetSnapshot],
    paths: dict[tuple[int, str, str], Path],
) -> None:
    protected_identities: dict[tuple[int, int], str] = {
        (manifest_snapshot.device, manifest_snapshot.inode): "input manifest",
        (protocol_snapshot.device, protocol_snapshot.inode): "frozen protocol",
    }
    for label, snapshot in code_snapshots.items():
        protected_identities[(snapshot.device, snapshot.inode)] = label
    for label, snapshot in source_asset_snapshots.items():
        protected_identities[(snapshot.device, snapshot.inode)] = f"source asset {label}"
    for key, path in paths.items():
        status = path.stat()
        identity = (status.st_dev, status.st_ino)
        if identity in protected_identities:
            fail(
                "INPUT_PATH_OVERLAP",
                f"image {key} overlaps protected {protected_identities[identity]}",
            )


def _load_evaluation_inputs(protocol_path: Path, manifest_path: Path) -> LoadedInputs:
    protocol, protocol_snapshot = _read_json(Path(protocol_path), "frozen protocol")
    code_snapshots = validate_protocol(protocol, require_digest=True, verify_code=True)
    after_verification, source_asset_snapshots = _verify_candidate_source_assets(
        "after_capture"
    )
    manifest, manifest_snapshot = _read_json(Path(manifest_path), "input manifest")
    if (protocol_snapshot.device, protocol_snapshot.inode) == (
        manifest_snapshot.device,
        manifest_snapshot.inode,
    ):
        fail("INPUT_PATH_OVERLAP", "protocol and manifest must be different files")
    views = _validate_manifest(manifest, protocol_snapshot, manifest_snapshot.path.parent)
    paths, declared_hashes, capture_evidence = _collect_image_paths(
        views, manifest_snapshot.path.parent
    )
    _reject_input_identity_overlap(
        manifest_snapshot,
        protocol_snapshot,
        code_snapshots,
        source_asset_snapshots,
        paths,
    )
    records, blank_statistics = _load_records(
        paths, declared_hashes, capture_evidence
    )
    return LoadedInputs(
        protocol=protocol,
        protocol_snapshot=protocol_snapshot,
        manifest_snapshot=manifest_snapshot,
        code_snapshots=code_snapshots,
        source_asset_verification_after_capture=after_verification,
        source_asset_snapshots=source_asset_snapshots,
        records=records,
        blank_statistics=blank_statistics,
    )


def _score_records(inputs: LoadedInputs) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows, repeat_noise, repeat_counts, common_repeat_scans = _build_view_rows(
        inputs.records, inputs.blank_statistics
    )
    decision = BASE._apply_decision(
        rows, repeat_noise, repeat_counts, common_repeat_scans
    )
    decision["methodSpecificHoldout"] = True
    decision["globallyPristine"] = False
    return rows, decision


def _result_input_evidence(inputs: LoadedInputs) -> dict[str, Any]:
    code_evidence = {
        label: {
            "relativePath": inputs.protocol[label]["relativePath"],
            "sha256": snapshot.sha256,
            "sizeBytes": snapshot.size_bytes,
        }
        for label, snapshot in inputs.code_snapshots.items()
        if not label.startswith("viewerCode:")
    }
    viewer_code_evidence = [
        {
            "relativePath": relative_path,
            "sha256": inputs.code_snapshots[f"viewerCode:{relative_path}"].sha256,
            "sizeBytes": inputs.code_snapshots[
                f"viewerCode:{relative_path}"
            ].size_bytes,
        }
        for relative_path in VIEWER_CODE_RELATIVE_PATHS
    ]
    return {
        "protocol": {
            "path": str(inputs.protocol_snapshot.path),
            "wholeFileSha256": inputs.protocol_snapshot.sha256,
            "sizeBytes": inputs.protocol_snapshot.size_bytes,
            "protocolDigest": copy.deepcopy(inputs.protocol["protocolDigest"]),
        },
        "manifest": {
            "path": str(inputs.manifest_snapshot.path),
            "sha256": inputs.manifest_snapshot.sha256,
            "sizeBytes": inputs.manifest_snapshot.size_bytes,
        },
        "code": code_evidence,
        "viewerCode": viewer_code_evidence,
        "prePixelChainDeclarations": {
            "cameraReceipt": copy.deepcopy(inputs.protocol["cameraReceipt"]),
            "sourceE57": copy.deepcopy(inputs.protocol["sourceE57"]),
            "candidateSourceProfiles": copy.deepcopy(
                inputs.protocol["candidateSourceProfiles"]
            ),
            "sourceAssetVerificationBeforeCapture": copy.deepcopy(
                inputs.protocol["sourceAssetVerificationBeforeCapture"]
            ),
            "transformHoldoutReceipt": copy.deepcopy(
                inputs.protocol["transformHoldoutReceipt"]
            ),
            "declaredMetadataPathsOpenedDuringScoring": False,
        },
    }


def _result_document(
    inputs: LoadedInputs, rows: list[dict[str, Any]], decision: dict[str, Any]
) -> dict[str, Any]:
    return {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "status": RESULT_STATUS,
        "authority": AUTHORITY,
        "globallyPristine": False,
        "physicalApproval": False,
        "runtimePromotionApproval": False,
        "publicReleaseApproval": False,
        "trainingApproval": False,
        "scope": {
            "roomLabel": ROOM_LABEL,
            "methodScope": METHOD_SCOPE,
            "scanIds": list(SCAN_IDS),
            "candidateIds": list(CANDIDATE_IDS),
            "referenceFaceName": REFERENCE_FACE_NAME,
        },
        "inputEvidence": _result_input_evidence(inputs),
        "sourceAssetVerificationAfterCapture": copy.deepcopy(
            inputs.source_asset_verification_after_capture
        ),
        "comparison": copy.deepcopy(EXPECTED_COMPARISON),
        "captureEncoding": {
            "id": CAPTURE_ENCODING,
            "decodedFormatRequired": "JPEG",
            "lossless": False,
        },
        "method": _method_evidence(inputs.protocol),
        "views": rows,
        "decision": decision,
        "permissions": copy.deepcopy(inputs.protocol["permissions"]),
        "priorUseDisclosure": copy.deepcopy(inputs.protocol["priorUseDisclosure"]),
        "safety": _safety_evidence(),
        "limitations": _limitations(),
    }


def _evaluate_context(protocol_path: Path, manifest_path: Path) -> EvaluationContext:
    inputs = _load_evaluation_inputs(protocol_path, manifest_path)
    rows, decision = _score_records(inputs)
    context = EvaluationContext(
        document=_seal_result(_result_document(inputs, rows, decision)),
        protocol_snapshot=inputs.protocol_snapshot,
        manifest_snapshot=inputs.manifest_snapshot,
        code_snapshots=inputs.code_snapshots,
        source_asset_snapshots=inputs.source_asset_snapshots,
        records=inputs.records,
    )
    _verify_evaluation_inputs(context)
    verify_result_receipt(context.document)
    return context


def evaluate_holdout(protocol: Path, manifest: Path) -> dict[str, Any]:
    return _evaluate_context(Path(protocol), Path(manifest)).document


def score_to_file(protocol: Path, manifest: Path, output: Path) -> dict[str, Any]:
    target = _prepare_output(Path(output), "result")
    context = _evaluate_context(Path(protocol), Path(manifest))
    protected_paths = {
        context.protocol_snapshot.path,
        context.manifest_snapshot.path,
        *(snapshot.path for snapshot in context.code_snapshots.values()),
        *(snapshot.path for snapshot in context.source_asset_snapshots.values()),
        *(record.path for record in context.records.values()),
    }
    if target.resolve(strict=False) in protected_paths:
        fail("OUTPUT_OVERLAPS_INPUT", "result output overlaps a protected input")
    _verify_evaluation_inputs(context)
    _write_create_only_json(target, context.document, "result")
    return context.document


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Freeze or run the private Reception method-specific computer-vision holdout. "
            "Both commands stream-hash the eight runtime source assets from disk and exact "
            "loopback HTTP responses. They do not open the E57 or protected receipt files."
        )
    )
    commands = parser.add_subparsers(dest="command", required=True)
    freeze = commands.add_parser(
        "freeze-protocol",
        help="validate a protocol draft and create one frozen JSON protocol",
    )
    freeze.add_argument("--draft", required=True, type=Path)
    freeze.add_argument("--output", required=True, type=Path)
    score = commands.add_parser(
        "score",
        help="score the three declared JPEG views and create one private JSON result",
    )
    score.add_argument("--protocol", required=True, type=Path)
    score.add_argument("--manifest", required=True, type=Path)
    score.add_argument("--output", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = build_parser().parse_args(argv)
        if arguments.command == "freeze-protocol":
            document = freeze_protocol(arguments.draft, arguments.output)
            summary = {
                "status": document["status"],
                "authority": AUTHORITY,
                "globallyPristine": False,
                "output": str(_absolute_lexical(arguments.output)),
                "protocolDigest": document["protocolDigest"]["sha256"],
                "plainLanguage": (
                    "Protocol frozen after byte-hashing all eight candidate source assets "
                    "from disk and localhost. No holdout JPEG pixels, E57, camera receipt, "
                    "or transform receipt were opened."
                ),
            }
        else:
            document = score_to_file(
                arguments.protocol, arguments.manifest, arguments.output
            )
            summary = {
                "status": document["status"],
                "directionalOutcome": document["decision"]["status"],
                "candidate": document["decision"]["candidate"],
                "authority": AUTHORITY,
                "globallyPristine": False,
                "physicalApproval": False,
                "runtimePromotionApproval": False,
                "publicReleaseApproval": False,
                "trainingApproval": False,
                "output": str(_absolute_lexical(arguments.output)),
                "resultDigest": document["receipt"]["sha256"],
                "plainLanguage": (
                    "Directional computer-vision result only. This is not physical "
                    "approval or permission to promote, publish, or train."
                ),
            }
        print(json.dumps(summary, sort_keys=True))
        return 0
    except ComparisonError as error:
        print(
            json.dumps(
                {
                    "status": "error_no_output_created",
                    "code": error.code,
                    "message": error.message,
                    "plainLanguage": "The check stopped safely. Fix the named input and run again.",
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
