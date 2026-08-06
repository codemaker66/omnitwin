#!/usr/bin/env python3
"""Extract exactly three locked E57 Image2D JPEG blobs into a private package.

The command is deliberately narrow.  It validates a frozen, self-digested
computer-vision protocol and the complete E57 hash before importing pye57.  It
then addresses only Image2D indexes 760, 778, and 850; it never enumerates or
reads Data3D point records.  A create-only directory is published only after
the source is hashed a second time and every output has been verified.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
from typing import Any, Callable, Mapping, Sequence
from urllib.parse import urlsplit


PROTOCOL_SCHEMA_VERSION = "venviewer.reception-e57-method-holdout-cv-protocol.v1"
EXTRACTION_SCHEMA_VERSION = "omnitwin.reception.e57-method-holdout-extraction.v1"
PROTOCOL_DIGEST_DOMAIN = b"venviewer.reception-e57-method-holdout-cv-protocol.v1\0"
EXTRACTION_DIGEST_DOMAIN = b"omnitwin.reception.e57-method-holdout-extraction.v1\0"
EXTRACTOR_RELATIVE_PATH = "tools/reception-hd/extract_e57_method_holdout_images.py"
MAX_PROTOCOL_BYTES = 4 * 1024 * 1024
HASH_CHUNK_BYTES = 8 * 1024 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

ROOT_KEYS = {
    "schemaVersion", "status", "authority", "globallyPristine", "roomLabel",
    "methodScope", "scanIds", "candidateIds", "referenceFaceName", "comparison",
    "repeatPolicy", "referenceJpegs", "scoringDependency", "wrapper",
    "cameraBuilder", "extractor", "cameraReceipt", "sourceE57",
    "candidateSourceProfiles", "transformHoldoutEvaluator", "transformHoldoutReceipt",
    "viewerCode", "sourceAssetVerificationBeforeCapture", "decisionRule",
    "priorUseDisclosure", "permissions", "protocolDigest",
}
CODE_PATHS = {
    "scoringDependency": "tools/reception-hd/compare_matched_renders.py",
    "wrapper": "tools/reception-hd/compare_method_holdout_renders.py",
    "cameraBuilder": "tools/reception-hd/build_e57_method_holdout_camera_views.py",
    "extractor": EXTRACTOR_RELATIVE_PATH,
    "transformHoldoutEvaluator": "tools/reception-hd/evaluate_e57_method_holdout_transform.py",
}
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
PERMISSIONS = {
    "physicalApproval": False,
    "runtimePromotionApproval": False,
    "publicReleaseApproval": False,
    "trainingApproval": False,
}

PRODUCTION_CONTRACT: dict[str, Any] = {
    "source": {
        "fileName": "cloud_0.e57",
        "sizeBytes": 20_518_437_888,
        "sha256": "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd",
    },
    "images": [
        {
            "scanId": 126, "image2DIndex": 760,
            "image2DGuid": "55fde40f78734299bc99ae05863b0837",
            "data3DGuid": "55fde40f78734299bc99ae05863b0832",
            "name": "Skybox 4", "fileName": "scan-126-skybox-4.jpg",
            "sha256": "777e6850400aff1f8d75cc39de94de847e07f7f3c8708d420b82c4c73f56165b",
            "sizeBytes": 2_787_216, "width": 4096, "height": 4096,
            "fx": 2048.0, "fy": 2048.0, "cx": 2048.0, "cy": 2048.0,
        },
        {
            "scanId": 129, "image2DIndex": 778,
            "image2DGuid": "b80ea44013204e87a581b1735db4656e",
            "data3DGuid": "b80ea44013204e87a581b1735db46569",
            "name": "Skybox 4", "fileName": "scan-129-skybox-4.jpg",
            "sha256": "8d5f13607d1c094297bb6b3688464d1a8ae6a4555ec51b610aa5cdce2c99fd9e",
            "sizeBytes": 2_864_361, "width": 4096, "height": 4096,
            "fx": 2048.0, "fy": 2048.0, "cx": 2048.0, "cy": 2048.0,
        },
        {
            "scanId": 141, "image2DIndex": 850,
            "image2DGuid": "33de3f9e46a24d83b257d67f3317dca2",
            "data3DGuid": "33de3f9e46a24d83b257d67f3317dc9d",
            "name": "Skybox 4", "fileName": "scan-141-skybox-4.jpg",
            "sha256": "747dbd122ae66c7815f1414100429a7704b8efbf84203f5ef5912c78b2dab677",
            "sizeBytes": 2_899_217, "width": 4096, "height": 4096,
            "fx": 2048.0, "fy": 2048.0, "cx": 2048.0, "cy": 2048.0,
        },
    ],
}
PRODUCTION_CONTRACT_CANONICAL_SHA256 = (
    "bc2341ffb2234eededd7ddfe28911cc2db8b6f10eb0263f86095f9060f4633d4"
)


class ExtractionError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


def fail(code: str, message: str) -> None:
    raise ExtractionError(code, message)


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            fail("DUPLICATE_JSON_KEY", f"JSON object repeats key {key!r}")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    fail("NONFINITE_JSON_NUMBER", f"JSON constant {value!r} is forbidden")


def _exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("INVALID_PROTOCOL", f"{label} must be an object")
    actual = set(value)
    if actual != keys:
        fail("INVALID_PROTOCOL_KEYS",
             f"{label} keys differ; missing={sorted(keys-actual)}, unexpected={sorted(actual-keys)}")
    return value


def _lower_sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or SHA256_RE.fullmatch(value) is None:
        fail("INVALID_PROTOCOL", f"{label} must be a lowercase SHA-256 hex digest")
    return value


def _positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        fail("INVALID_PROTOCOL", f"{label} must be a positive integer")
    return value


def _stat_identity(value: os.stat_result) -> tuple[int, int, int, int, int]:
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _open_file_identity(value: os.stat_result) -> tuple[int, int, int]:
    """Fields consistently reported by both Windows path-stat and descriptor-stat."""

    return (value.st_dev, value.st_ino, value.st_size)


def _stable_read(path: Path, label: str, maximum: int) -> tuple[bytes, Path, os.stat_result]:
    try:
        if path.is_symlink():
            fail("UNSAFE_INPUT_PATH", f"{label} may not be a symbolic link")
        resolved = path.resolve(strict=True)
        before = resolved.stat()
        if not stat.S_ISREG(before.st_mode) or before.st_size <= 0 or before.st_size > maximum:
            fail("INPUT_NOT_READABLE", f"{label} is not a regular file of an accepted size")
        payload = resolved.read_bytes()
        after = resolved.stat()
    except ExtractionError:
        raise
    except (OSError, RuntimeError) as error:
        fail("INPUT_NOT_READABLE", f"cannot read {label}: {error}")
    if len(payload) != before.st_size or _stat_identity(before) != _stat_identity(after):
        fail("SOURCE_MUTATED", f"{label} changed while it was read")
    return payload, resolved, before


def _stable_hash(path: Path, label: str) -> tuple[dict[str, Any], Path]:
    try:
        if path.is_symlink():
            fail("UNSAFE_INPUT_PATH", f"{label} may not be a symbolic link")
        resolved = path.resolve(strict=True)
        before = resolved.stat()
        if not stat.S_ISREG(before.st_mode) or before.st_size <= 0:
            fail("INPUT_NOT_READABLE", f"{label} must be a non-empty regular file")
        digest = hashlib.sha256()
        with resolved.open("rb", buffering=0) as stream:
            opened = os.fstat(stream.fileno())
            if _open_file_identity(opened) != _open_file_identity(before):
                fail("SOURCE_MUTATED", f"{label} changed before hashing began")
            while True:
                chunk = stream.read(HASH_CHUNK_BYTES)
                if not chunk:
                    break
                digest.update(chunk)
            closed = os.fstat(stream.fileno())
        after = resolved.stat()
    except ExtractionError:
        raise
    except (OSError, RuntimeError) as error:
        fail("INPUT_NOT_READABLE", f"cannot hash {label}: {error}")
    if _open_file_identity(before) != _open_file_identity(closed) or _stat_identity(before) != _stat_identity(after):
        fail("SOURCE_MUTATED", f"{label} changed while it was hashed")
    return {
        "path": str(resolved), "fileName": resolved.name, "sizeBytes": before.st_size,
        "sha256": digest.hexdigest(), "device": before.st_dev, "inode": before.st_ino,
        "mtimeNs": before.st_mtime_ns, "ctimeNs": before.st_ctime_ns,
    }, resolved


def _code_descriptor(value: Any, label: str, expected_path: str) -> dict[str, Any]:
    item = _exact_object(value, {"relativePath", "sha256"}, label)
    if item["relativePath"] != expected_path:
        fail("PROTOCOL_PIN_MISMATCH", f"{label}.relativePath must be {expected_path}")
    _lower_sha(item["sha256"], f"{label}.sha256")
    return item


def _receipt_descriptor(value: Any, label: str, schema: str, fixed_path: str) -> None:
    item = _exact_object(value, {"path", "sha256", "receiptSha256", "schemaVersion"}, label)
    if item["path"] != fixed_path or item["schemaVersion"] != schema:
        fail("PROTOCOL_PIN_MISMATCH", f"{label} path or schemaVersion changed")
    _lower_sha(item["sha256"], f"{label}.sha256")
    _lower_sha(item["receiptSha256"], f"{label}.receiptSha256")


def _loopback_asset_url(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        fail("INVALID_PROTOCOL", f"{label} must be a non-empty trimmed URL")
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError:
        fail("INVALID_PROTOCOL", f"{label} has an invalid port")
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or port not in {4174, 5175}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not parsed.path.startswith("/")
    ):
        fail("INVALID_PROTOCOL", f"{label} must be an exact loopback HTTP asset URL")
    return value


def _validate_source_asset_verification(
    value: Any,
    expected_assets: Sequence[dict[str, Any]],
) -> None:
    verification = _exact_object(
        value,
        {"phase", "method", "loopbackOnly", "redirectsAllowed", "assets"},
        "protocol.sourceAssetVerificationBeforeCapture",
    )
    if verification["phase"] != "before_capture":
        fail("PROTOCOL_PIN_MISMATCH", "source asset verification phase changed")
    if verification["method"] != "stream_sha256_disk_and_loopback_http_response_v1":
        fail("PROTOCOL_PIN_MISMATCH", "source asset verification method changed")
    if verification["loopbackOnly"] is not True or verification["redirectsAllowed"] is not False:
        fail("PROTOCOL_PIN_MISMATCH", "source asset verification network policy changed")
    rows = verification["assets"]
    if not isinstance(rows, list) or len(rows) != len(expected_assets):
        fail("PROTOCOL_PIN_MISMATCH", "source asset verification must contain exactly eight rows")
    for index, expected in enumerate(expected_assets):
        row = _exact_object(
            rows[index],
            {
                "candidateId", "profileId", "fileName", "path", "url",
                "expectedSizeBytes", "expectedSha256", "disk", "httpResponse",
            },
            f"protocol.sourceAssetVerificationBeforeCapture.assets[{index}]",
        )
        declared = {
            "candidateId": row["candidateId"],
            "profileId": row["profileId"],
            "fileName": row["fileName"],
            "path": row["path"],
            "url": row["url"],
            "sizeBytes": row["expectedSizeBytes"],
            "sha256": row["expectedSha256"],
        }
        if declared != expected:
            fail("PROTOCOL_PIN_MISMATCH", f"source asset verification row {index} changed")
        disk = _exact_object(row["disk"], {"sizeBytes", "sha256"}, f"asset row {index}.disk")
        response = _exact_object(
            row["httpResponse"],
            {"statusCode", "sizeBytes", "sha256", "redirected", "contentEncoding"},
            f"asset row {index}.httpResponse",
        )
        if disk != {"sizeBytes": expected["sizeBytes"], "sha256": expected["sha256"]}:
            fail("PROTOCOL_PIN_MISMATCH", f"source asset disk verification row {index} changed")
        if response != {
            "statusCode": 200,
            "sizeBytes": expected["sizeBytes"],
            "sha256": expected["sha256"],
            "redirected": False,
            "contentEncoding": "identity",
        }:
            fail("PROTOCOL_PIN_MISMATCH", f"source asset HTTP verification row {index} changed")


def _validate_protocol(document: Any, contract: Mapping[str, Any], tool_sha256: str) -> dict[str, Any]:
    root = _exact_object(document, ROOT_KEYS, "protocol")
    digest = _exact_object(root["protocolDigest"], {
        "algorithm", "domain", "sha256", "isSignature", "authenticatesCreator", "provesTimestamp"
    }, "protocol.protocolDigest")
    if digest["algorithm"] != "SHA-256" or digest["domain"] != PROTOCOL_SCHEMA_VERSION:
        fail("INVALID_PROTOCOL_DIGEST", "protocol digest algorithm or domain changed")
    if digest["isSignature"] is not False or digest["authenticatesCreator"] is not False or digest["provesTimestamp"] is not False:
        fail("INVALID_PROTOCOL_DIGEST", "protocol digest safety meaning changed")
    _lower_sha(digest["sha256"], "protocol.protocolDigest.sha256")
    unsigned = copy.deepcopy(root)
    unsigned.pop("protocolDigest")
    actual_digest = _sha256_bytes(PROTOCOL_DIGEST_DOMAIN + _canonical_json_bytes(unsigned))
    if digest["sha256"] != actual_digest:
        fail("PROTOCOL_DIGEST_MISMATCH", "protocol self-digest does not verify")

    exact_scalars = {
        "schemaVersion": PROTOCOL_SCHEMA_VERSION,
        "status": "frozen_before_method_specific_holdout_render_scoring",
        "authority": "none", "globallyPristine": False, "roomLabel": "Reception Room",
        "methodScope": "matched_render_method_specific_holdout_only",
        "scanIds": [126, 129, 141], "candidateIds": ["quality", "mobile"],
        "referenceFaceName": "Skybox 4",
        "decisionRule": "reuse_compare_matched_renders_directional_rule_v1",
    }
    for key, expected in exact_scalars.items():
        if root[key] != expected:
            fail("PROTOCOL_PIN_MISMATCH", f"protocol.{key} changed")
    if root["comparison"] != {"width": 1024, "height": 1024, "borderPixels": 24}:
        fail("PROTOCOL_PIN_MISMATCH", "protocol.comparison changed")
    if root["repeatPolicy"] != {
        "requiredScanId": 126, "requiredCandidateIds": ["quality", "mobile"],
        "repeatsForbiddenOnOtherScans": True,
    }:
        fail("PROTOCOL_PIN_MISMATCH", "protocol.repeatPolicy changed")
    if root["permissions"] != PERMISSIONS:
        fail("PERMISSION_ESCALATION", "all protocol permissions must remain false")
    if root["priorUseDisclosure"] != {
        "globallyPristine": False,
        "july14ImageEvidencePreviouslyUsed": True,
        "july14GeometryEvidencePreviouslyUsed": True,
        "statement": "Scans 126, 129, and 141 appeared in July 14 image and geometry diagnostics; they are held out only from this matched-render comparison method.",
    }:
        fail("PROTOCOL_PIN_MISMATCH", "protocol.priorUseDisclosure changed")

    for key, expected_path in CODE_PATHS.items():
        _code_descriptor(root[key], f"protocol.{key}", expected_path)
    if root["extractor"]["sha256"] != tool_sha256:
        fail("EXTRACTOR_SHA256_MISMATCH", "protocol does not pin the executing extractor bytes")
    viewer_code = root["viewerCode"]
    if not isinstance(viewer_code, list) or len(viewer_code) != len(VIEWER_CODE_RELATIVE_PATHS):
        fail(
            "PROTOCOL_PIN_MISMATCH",
            "protocol.viewerCode must contain the exact ordered 16-file capture chain",
        )
    observed_viewer_paths: list[str] = []
    for index, expected_path in enumerate(VIEWER_CODE_RELATIVE_PATHS):
        entry = _code_descriptor(
            viewer_code[index],
            f"protocol.viewerCode[{index}]",
            expected_path,
        )
        observed_viewer_paths.append(entry["relativePath"])
    if (
        tuple(observed_viewer_paths) != VIEWER_CODE_RELATIVE_PATHS
        or observed_viewer_paths != sorted(observed_viewer_paths)
    ):
        fail(
            "PROTOCOL_PIN_MISMATCH",
            "protocol.viewerCode paths must be the exact sorted capture chain",
        )
    _receipt_descriptor(
        root["cameraReceipt"], "protocol.cameraReceipt",
        "omnitwin.reception.e57-method-holdout-camera-views.v1",
        r"C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-e57-method-holdout-camera-views-2026-07-17.json",
    )
    _receipt_descriptor(
        root["transformHoldoutReceipt"], "protocol.transformHoldoutReceipt",
        "omnitwin.reception.e57-method-holdout-transform-evaluation.v1",
        r"C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-e57-method-holdout-transform-2026-07-17.json",
    )

    source = _exact_object(root["sourceE57"], {"fileName", "sizeBytes", "sha256"}, "protocol.sourceE57")
    if source != dict(contract["source"]):
        fail("PROTOCOL_PIN_MISMATCH", "protocol.sourceE57 differs from the extractor contract")

    references = root["referenceJpegs"]
    if not isinstance(references, list) or len(references) != 3:
        fail("INVALID_PROTOCOL", "protocol.referenceJpegs must contain exactly three ordered records")
    expected_references = [
        {"scanId": row["scanId"], "faceName": row["name"], "width": row["width"],
         "height": row["height"], "sizeBytes": row["sizeBytes"], "sha256": row["sha256"]}
        for row in contract["images"]
    ]
    for index, reference in enumerate(references):
        _exact_object(reference, {"scanId", "faceName", "width", "height", "sizeBytes", "sha256"},
                      f"protocol.referenceJpegs[{index}]")
    if references != expected_references:
        fail("PROTOCOL_PIN_MISMATCH", "protocol.referenceJpegs differ from the extractor contract")

    profiles = _exact_object(root["candidateSourceProfiles"], {"quality", "mobile"},
                             "protocol.candidateSourceProfiles")
    expected_verified_assets: list[dict[str, Any]] = []
    all_paths: list[str] = []
    all_urls: list[str] = []
    for candidate_id in ("quality", "mobile"):
        profile = _exact_object(profiles[candidate_id], {"profileId", "expectedGaussianCount", "assets"},
                                f"protocol.candidateSourceProfiles.{candidate_id}")
        if not isinstance(profile["profileId"], str) or not profile["profileId"]:
            fail("INVALID_PROTOCOL", f"{candidate_id} profileId must be non-empty")
        _positive_int(profile["expectedGaussianCount"], f"{candidate_id}.expectedGaussianCount")
        if not isinstance(profile["assets"], list) or len(profile["assets"]) != 4:
            fail("INVALID_PROTOCOL", f"{candidate_id}.assets must contain exactly four records")
        names: list[str] = []
        for index, asset in enumerate(profile["assets"]):
            record = _exact_object(asset, {"fileName", "path", "url", "sizeBytes", "sha256"},
                                   f"{candidate_id}.assets[{index}]")
            if not isinstance(record["fileName"], str) or not record["fileName"]:
                fail("INVALID_PROTOCOL", "asset fileName must be non-empty")
            names.append(record["fileName"])
            if (
                not isinstance(record["path"], str)
                or not record["path"]
                or record["path"] != record["path"].strip()
                or not Path(record["path"]).is_absolute()
                or ".." in Path(record["path"]).parts
            ):
                fail("INVALID_PROTOCOL", "asset path must be an absolute normalized path")
            _loopback_asset_url(record["url"], "asset.url")
            all_paths.append(record["path"])
            all_urls.append(record["url"])
            _positive_int(record["sizeBytes"], "asset.sizeBytes")
            _lower_sha(record["sha256"], "asset.sha256")
            expected_verified_assets.append({
                "candidateId": candidate_id,
                "profileId": profile["profileId"],
                "fileName": record["fileName"],
                "path": record["path"],
                "url": record["url"],
                "sizeBytes": record["sizeBytes"],
                "sha256": record["sha256"],
            })
        if len(names) != len(set(names)):
            fail("INVALID_PROTOCOL", f"{candidate_id}.assets contains duplicate fileName values")
    if len(all_paths) != len(set(all_paths)) or len(all_urls) != len(set(all_urls)):
        fail("INVALID_PROTOCOL", "candidate assets must have unique paths and URLs")
    _validate_source_asset_verification(
        root["sourceAssetVerificationBeforeCapture"],
        expected_verified_assets,
    )
    return root


def _read_protocol(path: Path, contract: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    payload, resolved, stat_record = _stable_read(path, "protocol", MAX_PROTOCOL_BYTES)
    try:
        document = json.loads(payload.decode("utf-8"), object_pairs_hook=_unique_object,
                              parse_constant=_reject_constant)
    except ExtractionError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("INVALID_PROTOCOL_JSON", str(error))
    tool_payload, tool_path, tool_stat = _stable_read(Path(__file__), "extractor", MAX_PROTOCOL_BYTES)
    tool_sha256 = _sha256_bytes(tool_payload)
    validated = _validate_protocol(document, contract, tool_sha256)
    return validated, {
        "path": str(resolved), "sizeBytes": stat_record.st_size,
        "sha256": _sha256_bytes(payload), "protocolDigest": validated["protocolDigest"]["sha256"],
        "extractorPath": str(tool_path), "extractorSizeBytes": tool_stat.st_size,
        "extractorSha256": tool_sha256,
    }


def _jpeg_dimensions(payload: bytes, label: str) -> tuple[int, int]:
    if len(payload) < 10 or payload[:2] != b"\xff\xd8":
        fail("INVALID_JPEG", f"{label} is not a JPEG stream")
    offset = 2
    sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while offset < len(payload):
        if payload[offset] != 0xFF:
            fail("INVALID_JPEG", f"{label} has malformed marker framing")
        while offset < len(payload) and payload[offset] == 0xFF:
            offset += 1
        if offset >= len(payload):
            break
        marker = payload[offset]
        offset += 1
        if marker in {0x01, *range(0xD0, 0xD9)}:
            continue
        if marker in {0xD9, 0xDA} or offset + 2 > len(payload):
            break
        length = int.from_bytes(payload[offset:offset + 2], "big")
        if length < 2 or offset + length > len(payload):
            fail("INVALID_JPEG", f"{label} has an invalid marker length")
        if marker in sof_markers:
            if length < 7:
                fail("INVALID_JPEG", f"{label} has a truncated SOF segment")
            height = int.from_bytes(payload[offset + 3:offset + 5], "big")
            width = int.from_bytes(payload[offset + 5:offset + 7], "big")
            if width <= 0 or height <= 0:
                fail("INVALID_JPEG", f"{label} has invalid dimensions")
            return width, height
        offset += length
    fail("INVALID_JPEG", f"{label} has no supported start-of-frame segment")


def _node_value(node: Any, key: str, label: str) -> Any:
    try:
        return node[key].value()
    except Exception as error:
        fail("E57_NODE_MISMATCH", f"cannot read {label}.{key}: {error}")


def _read_locked_image(images: Any, expected: Mapping[str, Any]) -> tuple[bytes, dict[str, Any]]:
    label = f"scan {expected['scanId']} Image2D {expected['image2DIndex']}"
    try:
        image = images[expected["image2DIndex"]]
        guid = str(_node_value(image, "guid", label))
        data3d_guid = str(_node_value(image, "associatedData3DGuid", label))
        name = str(_node_value(image, "name", label))
        representation = image["pinholeRepresentation"]
    except ExtractionError:
        raise
    except Exception as error:
        fail("E57_NODE_MISMATCH", f"cannot address {label}: {error}")
    if (guid, data3d_guid, name) != (expected["image2DGuid"], expected["data3DGuid"], expected["name"]):
        fail("E57_NODE_MISMATCH", f"{label} GUID, Data3D association, or name changed")
    try:
        width = int(_node_value(representation, "imageWidth", label))
        height = int(_node_value(representation, "imageHeight", label))
        focal = float(_node_value(representation, "focalLength", label))
        pixel_width = float(_node_value(representation, "pixelWidth", label))
        pixel_height = float(_node_value(representation, "pixelHeight", label))
        cx = float(_node_value(representation, "principalPointX", label))
        cy = float(_node_value(representation, "principalPointY", label))
    except (TypeError, ValueError, OverflowError) as error:
        fail("INTRINSICS_MISMATCH", f"{label} intrinsics are malformed: {error}")
    if not all(math.isfinite(value) for value in (focal, pixel_width, pixel_height, cx, cy)) or pixel_width <= 0 or pixel_height <= 0:
        fail("INTRINSICS_MISMATCH", f"{label} intrinsics are non-finite or non-positive")
    fx, fy = focal / pixel_width, focal / pixel_height
    if (width, height, fx, fy, cx, cy) != (
        expected["width"], expected["height"], expected["fx"], expected["fy"], expected["cx"], expected["cy"]
    ):
        fail("INTRINSICS_MISMATCH", f"{label} dimensions or pinhole intrinsics changed")
    try:
        blob = representation["jpegImage"]
        byte_count = int(blob.byteCount())
    except Exception as error:
        fail("JPEG_BLOB_MISMATCH", f"cannot read {label} JPEG blob metadata: {error}")
    if byte_count != expected["sizeBytes"]:
        fail("JPEG_BLOB_MISMATCH", f"{label} JPEG byte count changed")
    payload = bytearray(byte_count)
    try:
        read_count = blob.read(payload, 0, byte_count)
    except Exception as error:
        fail("JPEG_BLOB_MISMATCH", f"cannot read {label} JPEG blob: {error}")
    if isinstance(read_count, int) and read_count != byte_count:
        fail("JPEG_BLOB_MISMATCH", f"{label} JPEG blob was only partially read")
    raw = bytes(payload)
    if _sha256_bytes(raw) != expected["sha256"]:
        fail("JPEG_SHA256_MISMATCH", f"{label} JPEG SHA-256 changed")
    jpeg_width, jpeg_height = _jpeg_dimensions(raw, label)
    if (jpeg_width, jpeg_height) != (expected["width"], expected["height"]):
        fail("JPEG_DIMENSIONS_MISMATCH", f"{label} encoded JPEG dimensions changed")
    return raw, {
        "scanId": expected["scanId"], "image2DIndex": expected["image2DIndex"],
        "image2DGuid": guid, "data3DGuid": data3d_guid, "name": name,
        "fileName": expected["fileName"],
        "jpeg": {"sha256": expected["sha256"], "sizeBytes": byte_count,
                 "width": jpeg_width, "height": jpeg_height},
        "intrinsics": {"fxPixels": fx, "fyPixels": fy, "principalPointX": cx,
                       "principalPointY": cy},
    }


def _write_private_create_only(path: Path, payload: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_BINARY"):
        flags |= os.O_BINARY
    try:
        descriptor = os.open(path, flags, 0o600)
        try:
            with os.fdopen(descriptor, "wb", closefd=True) as stream:
                descriptor = -1
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        finally:
            if descriptor >= 0:
                os.close(descriptor)
        os.chmod(path, 0o600)
    except FileExistsError:
        fail("OUTPUT_EXISTS", f"refusing to overwrite {path}")
    except OSError as error:
        fail("OUTPUT_WRITE_FAILED", f"cannot write {path.name}: {error}")


def _prepare_output(path: Path) -> tuple[Path, Path]:
    if not path.name or path.name in {".", ".."}:
        fail("INVALID_OUTPUT_PATH", "output directory must name a new child directory")
    try:
        parent = path.parent.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        fail("INVALID_OUTPUT_PATH", f"output parent is unavailable: {error}")
    if not parent.is_dir():
        fail("INVALID_OUTPUT_PATH", "output parent must be an existing directory")
    output = parent / path.name
    if output.exists() or output.is_symlink():
        fail("OUTPUT_EXISTS", f"refusing to overwrite {output}")
    try:
        staging = Path(tempfile.mkdtemp(prefix=f".{path.name}.staging-", dir=parent))
        os.chmod(staging, 0o700)
    except OSError as error:
        fail("OUTPUT_WRITE_FAILED", f"cannot create private staging directory: {error}")
    return output, staging


def _seal_receipt(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    digest = _sha256_bytes(EXTRACTION_DIGEST_DOMAIN + _canonical_json_bytes(unsigned))
    return {**unsigned, "receipt": {
        "algorithm": "SHA-256", "domain": EXTRACTION_SCHEMA_VERSION, "sha256": digest,
        "isSignature": False, "authenticatesCreator": False, "provesTimestamp": False,
    }}


def verify_extraction_receipt(document: Any) -> None:
    if not isinstance(document, dict):
        fail("INVALID_EXTRACTION_RECEIPT", "extraction receipt must be an object")
    expected_root_keys = {
        "schemaVersion", "status", "authority", "testOnly", "evidenceEligible",
        "scope", "inputs", "images", "output", "permissions", "limitations", "receipt",
    }
    if set(document) != expected_root_keys:
        fail("INVALID_EXTRACTION_RECEIPT", "extraction receipt root fields changed")
    if document.get("schemaVersion") != EXTRACTION_SCHEMA_VERSION:
        fail("INVALID_EXTRACTION_RECEIPT", "extraction receipt schema changed")
    if document.get("authority") != "none":
        fail("INVALID_EXTRACTION_RECEIPT", "extraction receipt authority must be none")
    test_only = document.get("testOnly")
    evidence_eligible = document.get("evidenceEligible")
    if type(test_only) is not bool or type(evidence_eligible) is not bool:
        fail("INVALID_EXTRACTION_RECEIPT", "test/evidence flags must be booleans")
    expected_status = (
        "internal_test_only_injected_dependencies_unusable_as_evidence"
        if test_only
        else "production_exact_locked_extraction_authority_none"
    )
    if document.get("status") != expected_status or evidence_eligible is not (not test_only):
        fail("INVALID_EXTRACTION_RECEIPT", "status and evidence eligibility are inconsistent")
    scope = document.get("scope")
    if not isinstance(scope, dict):
        fail("INVALID_EXTRACTION_RECEIPT", "extraction scope must be an object")
    expected_indexes = [760, 778, 850]
    if scope.get("exactImage2DIndexesRequestedByExtractor") != expected_indexes:
        fail("INVALID_EXTRACTION_RECEIPT", "extractor request scope changed")
    if test_only:
        if any(
            scope.get(field) is not None
            for field in (
                "exactImage2DIndexesRead",
                "image2DEnumerationPerformed",
                "scanPointDataRead",
                "jpegPixelsDecoded",
            )
        ) or scope.get("injectedDependencySideEffectsExcluded") is not False:
            fail("INVALID_EXTRACTION_RECEIPT", "test-only receipt overclaims injected side effects")
    elif (
        scope.get("exactImage2DIndexesRead") != expected_indexes
        or scope.get("image2DEnumerationPerformed") is not False
        or scope.get("scanPointDataRead") is not False
        or scope.get("jpegPixelsDecoded") is not False
        or scope.get("injectedDependencySideEffectsExcluded") is not True
    ):
        fail("INVALID_EXTRACTION_RECEIPT", "production extraction scope changed")
    inputs = document.get("inputs")
    expected_execution_mode = (
        "internal_test_only_injected_dependencies"
        if test_only
        else "production_fixed_contract_and_loader"
    )
    if not isinstance(inputs, dict) or inputs.get("executionMode") != expected_execution_mode:
        fail("INVALID_EXTRACTION_RECEIPT", "execution mode does not match the receipt status")
    if document.get("permissions") != PERMISSIONS:
        fail("INVALID_EXTRACTION_RECEIPT", "extraction permissions changed")
    limitations = document.get("limitations")
    if not isinstance(limitations, list) or not limitations or not all(
        isinstance(item, str) and item for item in limitations
    ):
        fail("INVALID_EXTRACTION_RECEIPT", "receipt limitations must be non-empty text")
    if test_only and not any("unusable as production extraction evidence" in item for item in limitations):
        fail("INVALID_EXTRACTION_RECEIPT", "test-only receipt lacks its evidence warning")
    receipt = _exact_object(document.get("receipt"), {
        "algorithm", "domain", "sha256", "isSignature", "authenticatesCreator", "provesTimestamp"
    }, "extraction receipt digest")
    if receipt != {
        "algorithm": "SHA-256", "domain": EXTRACTION_SCHEMA_VERSION,
        "sha256": receipt.get("sha256"), "isSignature": False,
        "authenticatesCreator": False, "provesTimestamp": False,
    }:
        fail("INVALID_EXTRACTION_RECEIPT", "extraction receipt digest semantics changed")
    _lower_sha(receipt["sha256"], "extraction receipt sha256")
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt")
    actual = _sha256_bytes(EXTRACTION_DIGEST_DOMAIN + _canonical_json_bytes(unsigned))
    if receipt["sha256"] != actual:
        fail("EXTRACTION_RECEIPT_DIGEST_MISMATCH", "extraction receipt self-digest does not verify")


def _default_pye57_loader() -> Any:
    try:
        import pye57
    except ImportError:
        fail("PYE57_UNAVAILABLE", "pye57 is required after all protocol and E57 checks pass")
    return pye57


def _execution_mode(
    contract: Mapping[str, Any],
    pye57_loader: Callable[[], Any],
    *,
    _test_only_allow_injected_dependencies: bool,
) -> tuple[bool, bool]:
    """Return ``(test_only, evidence_eligible)`` after closing injection paths.

    The public CLI supplies neither dependency argument and therefore reaches
    only the exact production contract and loader.  Unit fixtures may inject
    either dependency only behind the explicit internal switch; every receipt
    produced in that mode is permanently labelled unusable as evidence.
    """

    contract_is_exact_production = (
        contract is PRODUCTION_CONTRACT
        and _sha256_bytes(_canonical_json_bytes(contract))
        == PRODUCTION_CONTRACT_CANONICAL_SHA256
    )
    loader_is_exact_production = pye57_loader is _default_pye57_loader
    injected = not contract_is_exact_production or not loader_is_exact_production
    if injected and not _test_only_allow_injected_dependencies:
        fail(
            "INJECTED_DEPENDENCIES_FORBIDDEN",
            "custom contracts or pye57 loaders require the internal test-only switch",
        )
    test_only = _test_only_allow_injected_dependencies
    return test_only, not test_only and not injected


def extract_holdout_images(
    protocol_path: Path, e57_path: Path, output_directory: Path, *,
    contract: Mapping[str, Any] = PRODUCTION_CONTRACT,
    pye57_loader: Callable[[], Any] = _default_pye57_loader,
    _test_only_allow_injected_dependencies: bool = False,
) -> tuple[Path, dict[str, Any]]:
    test_only, evidence_eligible = _execution_mode(
        contract,
        pye57_loader,
        _test_only_allow_injected_dependencies=(
            _test_only_allow_injected_dependencies
        ),
    )
    protocol, protocol_evidence = _read_protocol(protocol_path, contract)
    before, resolved_e57 = _stable_hash(e57_path, "E57 source")
    if before["fileName"] != contract["source"]["fileName"]:
        fail("E57_FILE_NAME_MISMATCH", "E57 source file name differs from the frozen contract")
    if before["sizeBytes"] != contract["source"]["sizeBytes"]:
        fail("E57_SIZE_MISMATCH", "E57 source size differs from the frozen contract")
    if before["sha256"] != contract["source"]["sha256"]:
        fail("E57_SHA256_MISMATCH", "E57 source SHA-256 differs from the frozen contract")
    output, staging = _prepare_output(output_directory)
    published = False
    try:
        module = pye57_loader()
        source = None
        image_file = None
        rows: list[dict[str, Any]] = []
        try:
            source = module.E57(str(resolved_e57))
            image_file = source.image_file
            root = image_file.root()
            images = root["images2D"]
            for expected in contract["images"]:
                payload, row = _read_locked_image(images, expected)
                _write_private_create_only(staging / expected["fileName"], payload)
                rows.append(row)
        except ExtractionError:
            raise
        except Exception as error:
            fail("E57_READ_FAILED", f"could not read the three locked Image2D records: {error}")
        finally:
            close = getattr(source, "close", None) if source is not None else None
            if not callable(close) and image_file is not None:
                close = getattr(image_file, "close", None)
            if callable(close):
                try:
                    close()
                except Exception as error:
                    fail("E57_CLOSE_FAILED", f"could not close E57 source: {error}")

        after, after_path = _stable_hash(resolved_e57, "E57 source after extraction")
        if after_path != resolved_e57 or before != after:
            fail("SOURCE_MUTATED", "E57 source identity, metadata, or SHA-256 changed during extraction")
        receipt = _seal_receipt({
            "schemaVersion": EXTRACTION_SCHEMA_VERSION,
            "status": (
                "internal_test_only_injected_dependencies_unusable_as_evidence"
                if test_only
                else "production_exact_locked_extraction_authority_none"
            ),
            "authority": "none",
            "testOnly": test_only,
            "evidenceEligible": evidence_eligible,
            "scope": {
                "roomLabel": "Reception Room", "methodScope": "matched_render_method_specific_holdout_only",
                "globallyPristine": False,
                "exactImage2DIndexesRequestedByExtractor": [
                    row["image2DIndex"] for row in rows
                ],
                "exactImage2DIndexesRead": (
                    None if test_only else [row["image2DIndex"] for row in rows]
                ),
                "image2DEnumerationPerformed": None if test_only else False,
                "scanPointDataRead": None if test_only else False,
                "jpegPixelsDecoded": None if test_only else False,
                "injectedDependencySideEffectsExcluded": not test_only,
            },
            "inputs": {
                "executionMode": (
                    "internal_test_only_injected_dependencies"
                    if test_only
                    else "production_fixed_contract_and_loader"
                ),
                "protocol": protocol_evidence,
                "e57Before": before,
                "e57After": after,
            },
            "images": rows,
            "output": {"directory": str(output), "fileNames": [row["fileName"] for row in rows],
                       "indexFileName": "extraction-receipt.json", "createOnly": True,
                       "privateDirectory": True, "atomicPublish": True},
            "permissions": dict(PERMISSIONS),
            "limitations": ([
                "Internal test-only dependencies were injected; this receipt is unusable as production extraction evidence.",
                "Injected Python can read, fabricate, mutate, or perform side effects beyond what this receipt can establish.",
                "The receipt self-digest is not a signature or trusted timestamp.",
            ] if test_only else [
                "The receipt self-digest is not a signature or trusted timestamp.",
                "This extraction grants no physical, runtime, public-release, or training approval.",
            ]),
        })
        verify_extraction_receipt(receipt)
        _write_private_create_only(staging / "extraction-receipt.json",
                                   _canonical_json_bytes(receipt) + b"\n")
        expected_names = {row["fileName"] for row in rows} | {"extraction-receipt.json"}
        if {entry.name for entry in staging.iterdir()} != expected_names:
            fail("OUTPUT_VERIFICATION_FAILED", "staging directory contains an unexpected file set")
        for row in rows:
            data = (staging / row["fileName"]).read_bytes()
            if len(data) != row["jpeg"]["sizeBytes"] or _sha256_bytes(data) != row["jpeg"]["sha256"]:
                fail("OUTPUT_VERIFICATION_FAILED", f"written {row['fileName']} does not verify")
        stored_receipt = json.loads((staging / "extraction-receipt.json").read_text(encoding="utf-8"),
                                    object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        verify_extraction_receipt(stored_receipt)
        if output.exists() or output.is_symlink():
            fail("OUTPUT_EXISTS", f"refusing to overwrite {output}")
        try:
            os.rename(staging, output)
        except FileExistsError:
            fail("OUTPUT_EXISTS", f"refusing to overwrite {output}")
        except OSError as error:
            fail("OUTPUT_PUBLISH_FAILED", f"cannot atomically publish output: {error}")
        published = True
        return output, receipt
    finally:
        if not published:
            shutil.rmtree(staging, ignore_errors=True)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--e57", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        output, receipt = extract_holdout_images(
            arguments.protocol, arguments.e57, arguments.output_directory
        )
    except ExtractionError as error:
        print(_canonical_json_bytes({"error": {"code": error.code, "message": error.message}}).decode("utf-8"),
              file=sys.stderr)
        return 2
    print(_canonical_json_bytes({
        "authority": "none", "outputDirectory": str(output),
        "receiptSha256": receipt["receipt"]["sha256"],
        "schemaVersion": receipt["schemaVersion"],
    }).decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
