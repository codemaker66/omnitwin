"""Retrieve likely E57 reference views for the Reception Room renders.

This is a local, private, authority-none computer-vision aid.  It ranks the
E57-derived cube images that look most like each fixed rendered view while
trying every lossless quarter-turn.  A high score is a search hypothesis, not
camera calibration, pose authority, physical truth, privacy clearance, or
permission to train.

The command is deliberately fail-closed:

* it never downloads model weights;
* it verifies one pinned AlexNet weights file before deserialising it;
* it verifies every rendered query against the fixed-view capture manifest;
* it fingerprints every E57-derived image that it reads;
* it writes the private output bundle atomically into a new directory; and
* it binds the report, boards, runtime, model, and tool source with SHA-256.

The implementation defines the small AlexNet inference graph directly.  This
avoids importing torchvision (which is not usable in the current workspace)
and prevents an implicit network fetch.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import math
import os
import platform
import re
import shutil
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Protocol, Sequence

import numpy as np
from PIL import Image, ImageDraw, ImageFont, PngImagePlugin


REPORT_SCHEMA = "venviewer.reception-room-e57-visual-retrieval.v2"
INDEX_SCHEMA = "venviewer.reception-room-e57-visual-retrieval-bundle.v2"
RESULT_TYPE = "exploratory_reference_retrieval_not_pose_or_acceptance"
E57_AUDIT_SCHEMA = "omnitwin.reception.e57-room-image-audit.v1"
E57_AUDIT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_ROOM_IMAGE_AUDIT_V1\0"
GEOMETRY_HELDOUT_SCHEMA = "omnitwin.reception.e57-geometry-edge-audit.v2"
GEOMETRY_HELDOUT_DIGEST_DOMAIN = (
    b"OMNITWIN_RECEPTION_E57_GEOMETRY_EDGE_AUDIT_V2\0"
)
PINNED_ALEXNET_SHA256 = (
    "7BE5BE791159472B1FBF3C69796F7CB30DCA7AD8466C2DF70058C37116CDEE02"
)
PINNED_ALEXNET_SIZE_BYTES = 244_408_911
PINNED_MODEL_ARCHITECTURE = "AlexNet fc7 (4096 dimensions)"
PINNED_MODEL_PREPROCESSING = (
    "RGB; shorter side resized to 256 with Pillow bilinear; deterministic "
    "224 center crop; ImageNet mean/std; every candidate tried at "
    "0/90/180/270 degrees clockwise"
)
HELDOUT_SCAN_IDS = (
    123,
    125,
    127,
    128,
    129,
    131,
    132,
    133,
    135,
    136,
    137,
    138,
    139,
    141,
    142,
    143,
)
SOURCE_E57_SHA256 = (
    "975039D11FC04CA681F038E499F358124BBCAB178AD5CE6324FA912212729CDD"
)
SOURCE_E57_SIZE_BYTES = 20_518_437_888
GEOMETRY_PROVENANCE_LIMIT = (
    "This validator proves internal arithmetic consistency and exact byte/code "
    "binding. Because authority is none and there is no trusted signature, a "
    "coherent synthetic report could still be fabricated and re-digested. This "
    "local protocol does not prove who ran it or that its evidence came from the E57."
)
QUERY_VIEWS = (
    "overview",
    "timber-left",
    "timber-right",
    "floor-surface",
    "ceiling-moulding",
    "column-skirting",
)
FACE_NAMES = ("back", "down", "front", "left", "right", "up")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$")
SHA256 = re.compile(r"^[0-9A-Fa-f]{64}$")

IMAGENET_MEAN = np.asarray((0.485, 0.456, 0.406), dtype=np.float32)
IMAGENET_STD = np.asarray((0.229, 0.224, 0.225), dtype=np.float32)


class RetrievalError(ValueError):
    """Raised when the evidence bundle cannot be built safely."""


@dataclass(frozen=True)
class BoundImage:
    name: str
    path: Path
    size_bytes: int
    sha256: str
    width: int
    height: int
    file_format: str
    data: bytes = field(repr=False, compare=False)


@dataclass(frozen=True)
class EmbeddingTask:
    image: BoundImage
    quarter_turns_clockwise: int = 0


class FeatureExtractor(Protocol):
    @property
    def evidence(self) -> dict[str, Any]: ...

    def extract(self, tasks: Sequence[EmbeddingTask]) -> np.ndarray: ...


def _is_link_like(path: Path) -> bool:
    if path.is_symlink():
        return True
    is_junction = getattr(path, "is_junction", None)
    return bool(is_junction()) if callable(is_junction) else False


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest().upper()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _capture_tool_source() -> dict[str, Any]:
    path = Path(__file__)
    if _is_link_like(path):
        raise RetrievalError("retrieval tool source must not be a symbolic link")
    resolved = path.resolve(strict=True)
    if not resolved.is_file():
        raise RetrievalError("retrieval tool source is not a regular file")
    data = resolved.read_bytes()
    return {
        "name": resolved.name,
        "sizeBytes": len(data),
        "sha256": _sha256_bytes(data),
    }


def _verify_tool_source_still_matches(evidence: dict[str, Any]) -> None:
    if _capture_tool_source() != evidence:
        raise RetrievalError("retrieval tool source changed during execution")


def _canonical_sha256(value: Any) -> str:
    try:
        encoded = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise RetrievalError("report contains unsupported JSON values") from error
    return _sha256_bytes(encoded)


def _strict_json(data: bytes, label: str) -> dict[str, Any]:
    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise RetrievalError(f"{label} contains duplicate JSON key: {key}")
            result[key] = value
        return result

    def reject_constant(value: str) -> None:
        raise RetrievalError(f"{label} contains unsupported number: {value}")

    try:
        value = json.loads(
            data.decode("utf-8"),
            object_pairs_hook=reject_duplicates,
            parse_constant=reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RetrievalError(f"{label} is not strict UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise RetrievalError(f"{label} must contain one JSON object")
    return value


def parse_scan_range(value: str) -> tuple[int, ...]:
    match = re.fullmatch(r"([0-9]{1,6})-([0-9]{1,6})", value.strip())
    if match is None:
        raise RetrievalError("scan range must look like 122-144")
    first, last = (int(match.group(1)), int(match.group(2)))
    if first > last:
        raise RetrievalError("scan range start must not exceed its end")
    if last - first + 1 > 1000:
        raise RetrievalError("scan range is unexpectedly large")
    return tuple(range(first, last + 1))


def rotate_quarter_turns(image: Image.Image, quarter_turns_clockwise: int) -> Image.Image:
    turns = quarter_turns_clockwise % 4
    if turns == 0:
        return image.copy()
    if turns == 1:
        return image.transpose(Image.Transpose.ROTATE_270)
    if turns == 2:
        return image.transpose(Image.Transpose.ROTATE_180)
    return image.transpose(Image.Transpose.ROTATE_90)


def _safe_direct_child(root: Path, name: str) -> Path:
    if SAFE_NAME.fullmatch(name) is None or Path(name).name != name:
        raise RetrievalError(f"unsafe input basename: {name!r}")
    unresolved = root / name
    if _is_link_like(unresolved):
        raise RetrievalError(f"symbolic-link inputs are not accepted: {name}")
    candidate = unresolved.resolve(strict=True)
    if candidate.parent != root:
        raise RetrievalError(f"input escapes its declared folder: {name}")
    if not candidate.is_file():
        raise RetrievalError(f"input is not a file: {name}")
    return candidate


def _bind_image(path: Path, expected_format: str | None = None) -> BoundImage:
    try:
        data = path.read_bytes()
    except OSError as error:
        raise RetrievalError(f"image bytes cannot be read: {path.name}") from error
    try:
        with Image.open(io.BytesIO(data)) as source:
            width, height = source.size
            file_format = str(source.format or "UNKNOWN").upper()
            if width <= 0 or height <= 0 or width * height > 20_000_000:
                raise RetrievalError(f"image has unsupported dimensions: {path.name}")
            orientation = source.getexif().get(274, 1)
            if orientation not in (None, 1):
                raise RetrievalError(
                    f"image has an unsupported EXIF orientation: {path.name}"
                )
            source.load()
    except RetrievalError:
        raise
    except (OSError, ValueError) as error:
        raise RetrievalError(f"image cannot be fully decoded: {path.name}") from error
    if expected_format is not None and file_format != expected_format:
        raise RetrievalError(
            f"unexpected file format for {path.name}: {file_format}; expected {expected_format}"
        )
    return BoundImage(
        name=path.name,
        path=path,
        size_bytes=len(data),
        sha256=_sha256_bytes(data),
        width=width,
        height=height,
        file_format=file_format,
        data=data,
    )


def _manifest_integrity(manifest: dict[str, Any]) -> dict[str, tuple[int, str]]:
    rows = manifest.get("screenshotIntegrity")
    if not isinstance(rows, list) or not rows:
        raise RetrievalError("capture manifest has no screenshotIntegrity list")
    result: dict[str, tuple[int, str]] = {}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise RetrievalError(f"screenshotIntegrity[{index}] must be an object")
        name, size_bytes, sha256 = row.get("name"), row.get("bytes"), row.get("sha256")
        if not isinstance(name, str) or SAFE_NAME.fullmatch(name) is None:
            raise RetrievalError(f"screenshotIntegrity[{index}] has an unsafe name")
        if name in result:
            raise RetrievalError(f"capture manifest repeats screenshot: {name}")
        if not isinstance(size_bytes, int) or size_bytes < 0:
            raise RetrievalError(f"capture manifest has invalid size for {name}")
        if not isinstance(sha256, str) or SHA256.fullmatch(sha256) is None:
            raise RetrievalError(f"capture manifest has invalid SHA-256 for {name}")
        result[name] = (size_bytes, sha256.upper())
    return result


def bind_query_images(
    query_root: Path,
    capture_manifest: Path,
    query_variant: str,
) -> tuple[list[BoundImage], dict[str, Any]]:
    if SAFE_NAME.fullmatch(query_variant) is None:
        raise RetrievalError("query variant contains unsupported characters")
    root = query_root.resolve(strict=True)
    if _is_link_like(query_root) or not root.is_dir():
        raise RetrievalError("query root must be a folder")
    manifest_path = capture_manifest.resolve(strict=True)
    manifest_bytes = manifest_path.read_bytes()
    manifest = _strict_json(manifest_bytes, "capture manifest")
    integrity = _manifest_integrity(manifest)

    images: list[BoundImage] = []
    for view in QUERY_VIEWS:
        name = f"matrix-{view}-{query_variant}.png"
        declaration = integrity.get(name)
        if declaration is None:
            raise RetrievalError(f"capture manifest does not bind required query: {name}")
        image = _bind_image(_safe_direct_child(root, name), "PNG")
        expected_size, expected_sha256 = declaration
        if image.size_bytes != expected_size or image.sha256 != expected_sha256:
            raise RetrievalError(f"query fails capture-manifest integrity: {name}")
        images.append(image)
    dimensions = {(image.width, image.height) for image in images}
    if len(dimensions) != 1:
        raise RetrievalError("fixed-view queries do not share one pixel size")
    return images, {
        "name": manifest_path.name,
        "sizeBytes": len(manifest_bytes),
        "sha256": _sha256_bytes(manifest_bytes),
        "declaredSchemaVersion": manifest.get("schemaVersion"),
        "inputIntegrityStatus": "verified_for_all_six_queries",
    }


def bind_candidate_images(
    candidate_root: Path,
    scan_ids: Sequence[int],
) -> tuple[list[BoundImage], dict[str, Any] | None]:
    root = candidate_root.resolve(strict=True)
    if _is_link_like(candidate_root) or not root.is_dir():
        raise RetrievalError("candidate root must be a folder")
    images: list[BoundImage] = []
    for scan_id in scan_ids:
        for face in FACE_NAMES:
            name = f"scan_{scan_id:03d}_{face}.jpg"
            image = _bind_image(_safe_direct_child(root, name), "JPEG")
            if image.width != image.height:
                raise RetrievalError(f"candidate cube image is not square: {name}")
            images.append(image)
    if len({image.name for image in images}) != len(images):
        raise RetrievalError("candidate image names are not unique")

    derivation_path = root / "_extract_v3_report.json"
    derivation: dict[str, Any] | None = None
    if _is_link_like(derivation_path):
        raise RetrievalError("candidate derivation report must not be a symbolic link")
    if derivation_path.exists() and not derivation_path.is_file():
        raise RetrievalError("candidate derivation report must be a regular file")
    if derivation_path.is_file():
        data = derivation_path.read_bytes()
        _strict_json(data, "candidate derivation report")
        derivation = {
            "name": derivation_path.name,
            "sizeBytes": len(data),
            "sha256": _sha256_bytes(data),
            "lineageStatus": "descriptive_only_not_authenticated",
        }
    return images, derivation


def bind_e57_audit(
    audit_path: Path,
    scan_ids: Sequence[int],
    candidates: Sequence[BoundImage],
) -> tuple[dict[str, Any], dict[str, str]]:
    resolved = audit_path.resolve(strict=True)
    if _is_link_like(audit_path) or not resolved.is_file():
        raise RetrievalError("E57 image audit must be a regular file")
    data = resolved.read_bytes()
    report = _strict_json(data, "E57 image audit")
    if report.get("schemaVersion") != E57_AUDIT_SCHEMA:
        raise RetrievalError("E57 image audit has an unsupported schema")
    if report.get("authority") != "none":
        raise RetrievalError("E57 image audit must remain authority-none")
    supplied_digest = report.get("payloadSha256")
    if not isinstance(supplied_digest, str) or SHA256.fullmatch(supplied_digest) is None:
        raise RetrievalError("E57 image audit has no valid payload SHA-256")
    unsigned = copy.deepcopy(report)
    unsigned.pop("payloadSha256", None)
    expected_digest = hashlib.sha256(
        E57_AUDIT_DIGEST_DOMAIN
        + json.dumps(
            unsigned,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    if supplied_digest.lower() != expected_digest:
        raise RetrievalError("E57 image audit payload SHA-256 does not match")

    rows = report.get("scans")
    if not isinstance(rows, list):
        raise RetrievalError("E57 image audit has no scan list")
    selected = [row for row in rows if isinstance(row, dict) and row.get("scanId") in scan_ids]
    selected.sort(key=lambda row: row["scanId"])
    if [row["scanId"] for row in selected] != list(scan_ids):
        raise RetrievalError("E57 image audit does not contain the exact selected scans")

    declared: dict[str, tuple[int, str, int, int]] = {}
    review_states: dict[str, str] = {}
    for scan in selected:
        cubefaces = scan.get("cubefaces")
        if not isinstance(cubefaces, list) or len(cubefaces) != 6:
            raise RetrievalError(
                f"E57 image audit scan {scan['scanId']} does not bind six cube faces"
            )
        review_state = scan.get("visualReviewState")
        if not isinstance(review_state, str):
            raise RetrievalError(
                f"E57 image audit scan {scan['scanId']} has no visual review state"
            )
        for face in cubefaces:
            if not isinstance(face, dict):
                raise RetrievalError("E57 image audit contains a malformed cube face")
            name = face.get("fileName")
            size_bytes = face.get("sizeBytes")
            sha256 = face.get("sha256")
            width, height = face.get("width"), face.get("height")
            if (
                not isinstance(name, str)
                or SAFE_NAME.fullmatch(name) is None
                or not isinstance(size_bytes, int)
                or not isinstance(sha256, str)
                or SHA256.fullmatch(sha256) is None
                or not isinstance(width, int)
                or not isinstance(height, int)
            ):
                raise RetrievalError("E57 image audit contains invalid cube-face evidence")
            if name in declared:
                raise RetrievalError(f"E57 image audit repeats cube face: {name}")
            declared[name] = (size_bytes, sha256.upper(), width, height)
            review_states[name] = review_state

    actual_names = {image.name for image in candidates}
    if set(declared) != actual_names:
        raise RetrievalError("E57 image audit and selected cube-face names differ")
    for image in candidates:
        if declared[image.name] != (
            image.size_bytes,
            image.sha256,
            image.width,
            image.height,
        ):
            raise RetrievalError(
                f"cube face fails E57 image-audit integrity: {image.name}"
            )
    counts = report.get("counts")
    return (
        {
            "name": resolved.name,
            "sizeBytes": len(data),
            "sha256": _sha256_bytes(data),
            "schemaVersion": E57_AUDIT_SCHEMA,
            "payloadSha256": supplied_digest.lower(),
            "payloadIntegrityStatus": "self_digest_verified_not_provenance",
            "selectedScanIds": list(scan_ids),
            "selectedCubeFacesVerified": len(candidates),
            "declaredTotalCubeFaces": (
                counts.get("cubefaces") if isinstance(counts, dict) else None
            ),
            "authority": "none",
        },
        review_states,
    )


def bind_geometry_heldout_report(path: Path) -> dict[str, Any]:
    resolved = path.resolve(strict=True)
    if _is_link_like(path) or not resolved.is_file():
        raise RetrievalError("geometry held-out report must be a regular file")
    data = resolved.read_bytes()
    report = _strict_json(data, "geometry held-out report")
    if report.get("schemaVersion") != GEOMETRY_HELDOUT_SCHEMA:
        raise RetrievalError("geometry held-out report has an unsupported schema")
    if report.get("authority") != "none":
        raise RetrievalError("geometry held-out report must remain authority-none")
    supplied = report.get("payloadSha256")
    if not isinstance(supplied, str) or SHA256.fullmatch(supplied) is None:
        raise RetrievalError("geometry held-out report has no valid payload SHA-256")
    unsigned = copy.deepcopy(report)
    unsigned.pop("payloadSha256", None)
    expected = hashlib.sha256(
        GEOMETRY_HELDOUT_DIGEST_DOMAIN
        + json.dumps(
            unsigned,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    if supplied.lower() != expected:
        raise RetrievalError("geometry held-out report payload SHA-256 does not match")
    result, scope = report.get("result"), report.get("scope")
    if not isinstance(result, dict) or not isinstance(scope, dict):
        raise RetrievalError("geometry held-out report has no result or scope")
    status_counts = result.get("statusCounts")
    source_e57 = scope.get("sourceE57")
    if (
        result.get("status") != "REJECT_GEOMETRY_MISMATCH"
        or result.get("trainingPermitted") is not False
        or result.get("knownPoseMaterializationPermitted") is not False
        or result.get("pointColourFieldsRequestedOrRead") is not False
        or not isinstance(status_counts, dict)
        or status_counts.get("PASS_DISCRETE_GEOMETRY_ORIENTATION") != 82
        or scope.get("imageCount") != 96
        or scope.get("heldOutScanIdsRead") != list(HELDOUT_SCAN_IDS)
        or scope.get("developmentEvidenceProvenanceLimit")
        != GEOMETRY_PROVENANCE_LIMIT
        or not isinstance(source_e57, dict)
        or source_e57.get("fileName") != "cloud_0.e57"
        or str(source_e57.get("sha256", "")).upper() != SOURCE_E57_SHA256
        or source_e57.get("sizeBytes") != SOURCE_E57_SIZE_BYTES
    ):
        raise RetrievalError("geometry held-out report no longer binds the frozen negative result")
    return {
        "name": resolved.name,
        "sizeBytes": len(data),
        "sha256": _sha256_bytes(data),
        "schemaVersion": GEOMETRY_HELDOUT_SCHEMA,
        "payloadSha256": supplied.lower(),
        "payloadIntegrityStatus": "self_digest_verified_not_provenance",
        "status": "REJECT_GEOMETRY_MISMATCH",
        "passCount": 82,
        "imageCount": 96,
        "trainingPermitted": False,
        "knownPoseMaterializationPermitted": False,
        "heldOutScanIdsRead": list(HELDOUT_SCAN_IDS),
        "sourceE57": {
            "fileName": "cloud_0.e57",
            "sha256": SOURCE_E57_SHA256,
            "sizeBytes": SOURCE_E57_SIZE_BYTES,
        },
        "developmentEvidenceProvenanceLimit": GEOMETRY_PROVENANCE_LIMIT,
        "authority": "none",
    }


def verify_model_weights(path: Path, expected_sha256: str) -> dict[str, Any]:
    if SHA256.fullmatch(expected_sha256) is None:
        raise RetrievalError("expected model SHA-256 must contain 64 hex characters")
    resolved = path.resolve(strict=True)
    if not resolved.is_file():
        raise RetrievalError("model weights path must be a file")
    data = resolved.read_bytes()
    actual = _sha256_bytes(data)
    if actual != expected_sha256.upper():
        raise RetrievalError(
            f"model weights SHA-256 mismatch: got {actual}; expected {expected_sha256.upper()}"
        )
    return {
        "name": resolved.name,
        "sizeBytes": len(data),
        "sha256": actual,
        "verification": "matched_before_weights_only_deserialisation",
    }


def _preprocess_image(image: Image.Image) -> np.ndarray:
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width < height:
        resized_width = 256
        resized_height = max(256, round(height * 256 / width))
    else:
        resized_height = 256
        resized_width = max(256, round(width * 256 / height))
    resized = rgb.resize((resized_width, resized_height), Image.Resampling.BILINEAR)
    left = (resized_width - 224) // 2
    top = (resized_height - 224) // 2
    array = np.asarray(
        resized.crop((left, top, left + 224, top + 224)), dtype=np.float32
    ) / np.float32(255.0)
    array = (array - IMAGENET_MEAN) / IMAGENET_STD
    return np.ascontiguousarray(array.transpose(2, 0, 1))


class AlexNetFc7Extractor:
    """Pinned, no-network AlexNet fc7 feature extractor."""

    def __init__(
        self,
        weights_path: Path,
        expected_sha256: str = PINNED_ALEXNET_SHA256,
        device: str = "cpu",
        batch_size: int = 16,
    ) -> None:
        self._tool_source_evidence = _capture_tool_source()
        if expected_sha256.upper() != PINNED_ALEXNET_SHA256:
            raise RetrievalError(
                "AlexNet extractor accepts only the SHA-256 pinned in this tool"
            )
        if batch_size < 1 or batch_size > 256:
            raise RetrievalError("batch size must be between 1 and 256")
        if device not in {"cpu", "cuda"}:
            raise RetrievalError("device must be cpu or cuda")
        self._weights = verify_model_weights(weights_path, expected_sha256)
        try:
            import torch
            from torch import nn
        except ImportError as error:
            raise RetrievalError("PyTorch is required for AlexNet retrieval") from error
        if device == "cuda" and not torch.cuda.is_available():
            raise RetrievalError("CUDA was requested but is not available")
        self._device = torch.device(device)

        weights_file = weights_path.resolve(strict=True)
        weights_data = weights_file.read_bytes()
        actual_weights_sha256 = _sha256_bytes(weights_data)
        if actual_weights_sha256 != expected_sha256.upper():
            raise RetrievalError("model weights changed after initial verification")

        class AlexNetFc7(nn.Module):
            def __init__(self) -> None:
                super().__init__()
                self.features = nn.Sequential(
                    nn.Conv2d(3, 64, kernel_size=11, stride=4, padding=2),
                    nn.ReLU(inplace=True),
                    nn.MaxPool2d(kernel_size=3, stride=2),
                    nn.Conv2d(64, 192, kernel_size=5, padding=2),
                    nn.ReLU(inplace=True),
                    nn.MaxPool2d(kernel_size=3, stride=2),
                    nn.Conv2d(192, 384, kernel_size=3, padding=1),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(384, 256, kernel_size=3, padding=1),
                    nn.ReLU(inplace=True),
                    nn.Conv2d(256, 256, kernel_size=3, padding=1),
                    nn.ReLU(inplace=True),
                    nn.MaxPool2d(kernel_size=3, stride=2),
                )
                self.avgpool = nn.AdaptiveAvgPool2d((6, 6))
                self.classifier = nn.Sequential(
                    nn.Dropout(),
                    nn.Linear(256 * 6 * 6, 4096),
                    nn.ReLU(inplace=True),
                    nn.Dropout(),
                    nn.Linear(4096, 4096),
                    nn.ReLU(inplace=True),
                    nn.Linear(4096, 1000),
                )

            def forward(self, tensor: Any) -> Any:
                tensor = self.features(tensor)
                tensor = self.avgpool(tensor)
                tensor = torch.flatten(tensor, 1)
                for layer in list(self.classifier)[:6]:
                    tensor = layer(tensor)
                return tensor

        torch.manual_seed(0)
        torch.set_num_threads(1)
        try:
            torch.set_num_interop_threads(1)
        except RuntimeError:
            pass
        if hasattr(torch.backends, "mkldnn"):
            torch.backends.mkldnn.enabled = False
        if self._device.type == "cuda":
            torch.cuda.manual_seed_all(0)
            torch.backends.cuda.matmul.allow_tf32 = False
            torch.backends.cudnn.allow_tf32 = False
            torch.backends.cudnn.benchmark = False
            torch.backends.cudnn.deterministic = True
        torch.use_deterministic_algorithms(True)
        self._torch = torch
        self._nn = nn
        self._batch_size = batch_size
        self._model = AlexNetFc7()
        try:
            state = torch.load(
                io.BytesIO(weights_data),
                map_location="cpu",
                weights_only=True,
            )
            expected_state = self._model.state_dict()
            if not isinstance(state, dict) or set(state) != set(expected_state):
                raise RetrievalError("pinned model weights have unexpected tensor keys")
            for key, expected_tensor in expected_state.items():
                tensor = state[key]
                if (
                    not isinstance(tensor, torch.Tensor)
                    or tensor.dtype != torch.float32
                    or tuple(tensor.shape) != tuple(expected_tensor.shape)
                    or not bool(torch.isfinite(tensor).all())
                ):
                    raise RetrievalError(
                        f"pinned model tensor is invalid: {key}"
                    )
            self._model.load_state_dict(state, strict=True)
        except RetrievalError:
            raise
        except Exception as error:
            raise RetrievalError("pinned model weights do not match AlexNet") from error
        self._model.eval().to(self._device)
        determinism_controls = [
            "manual seed 0",
            "one CPU/inter-op thread requested",
            "MKLDNN disabled",
            "deterministic algorithms required",
        ]
        if self._device.type == "cuda":
            determinism_controls.extend(
                [
                    "cuDNN benchmark disabled",
                    "cuDNN deterministic mode required",
                    "TF32 disabled",
                ]
            )
        self._evidence = {
            "architecture": PINNED_MODEL_ARCHITECTURE,
            "weights": self._weights,
            "expectedSha256FrozenInTool": True,
            "preprocessing": PINNED_MODEL_PREPROCESSING,
            "networkAccess": "none",
            "torchVersion": str(torch.__version__),
            "device": str(self._device),
            "cudaDevice": (
                torch.cuda.get_device_name(self._device)
                if self._device.type == "cuda"
                else None
            ),
            "determinismControls": determinism_controls,
        }
        _validate_pinned_model_evidence(self._evidence)
        _verify_tool_source_still_matches(self._tool_source_evidence)

    @property
    def evidence(self) -> dict[str, Any]:
        return copy.deepcopy(self._evidence)

    @property
    def tool_source_evidence(self) -> dict[str, Any]:
        return copy.deepcopy(self._tool_source_evidence)

    def extract(self, tasks: Sequence[EmbeddingTask]) -> np.ndarray:
        if not tasks:
            raise RetrievalError("feature extraction received no images")
        rows: list[np.ndarray] = []
        torch = self._torch
        with torch.inference_mode():
            for start in range(0, len(tasks), self._batch_size):
                arrays: list[np.ndarray] = []
                for task in tasks[start : start + self._batch_size]:
                    with Image.open(io.BytesIO(task.image.data)) as source:
                        source.load()
                        rotated = rotate_quarter_turns(
                            source, task.quarter_turns_clockwise
                        )
                        arrays.append(_preprocess_image(rotated))
                batch = torch.from_numpy(np.stack(arrays)).to(self._device)
                features = self._model(batch)
                features = self._nn.functional.normalize(features, dim=1)
                rows.append(features.detach().cpu().numpy().astype(np.float32))
        result = np.concatenate(rows, axis=0)
        if result.shape != (len(tasks), 4096) or not np.isfinite(result).all():
            raise RetrievalError("feature extractor returned invalid AlexNet embeddings")
        return result


def _validate_pinned_model_evidence(evidence: Any) -> None:
    expected_keys = {
        "architecture",
        "cudaDevice",
        "determinismControls",
        "device",
        "expectedSha256FrozenInTool",
        "networkAccess",
        "preprocessing",
        "torchVersion",
        "weights",
    }
    if not isinstance(evidence, dict) or set(evidence) != expected_keys:
        raise RetrievalError("model evidence does not describe the pinned AlexNet extractor")
    weights = evidence.get("weights")
    if (
        evidence.get("architecture") != PINNED_MODEL_ARCHITECTURE
        or evidence.get("preprocessing") != PINNED_MODEL_PREPROCESSING
        or evidence.get("expectedSha256FrozenInTool") is not True
        or evidence.get("networkAccess") != "none"
        or evidence.get("device") not in {"cpu", "cuda"}
        or not isinstance(evidence.get("torchVersion"), str)
        or not evidence["torchVersion"]
        or not isinstance(weights, dict)
        or set(weights) != {"name", "sizeBytes", "sha256", "verification"}
        or not isinstance(weights.get("name"), str)
        or SAFE_NAME.fullmatch(weights["name"]) is None
        or weights.get("sizeBytes") != PINNED_ALEXNET_SIZE_BYTES
        or weights.get("sha256") != PINNED_ALEXNET_SHA256
        or weights.get("verification")
        != "matched_before_weights_only_deserialisation"
    ):
        raise RetrievalError("model evidence does not bind the pinned AlexNet weights")
    expected_controls = [
        "manual seed 0",
        "one CPU/inter-op thread requested",
        "MKLDNN disabled",
        "deterministic algorithms required",
    ]
    if evidence["device"] == "cuda":
        expected_controls.extend(
            [
                "cuDNN benchmark disabled",
                "cuDNN deterministic mode required",
                "TF32 disabled",
            ]
        )
        if not isinstance(evidence.get("cudaDevice"), str) or not evidence["cudaDevice"]:
            raise RetrievalError("CUDA model evidence has no device name")
    elif evidence.get("cudaDevice") is not None:
        raise RetrievalError("CPU model evidence unexpectedly names a CUDA device")
    if evidence.get("determinismControls") != expected_controls:
        raise RetrievalError("model evidence has unexpected determinism controls")


def _normalise_embeddings(value: np.ndarray, expected_rows: int) -> np.ndarray:
    array = np.asarray(value, dtype=np.float64)
    if array.ndim != 2 or array.shape[0] != expected_rows or array.shape[1] < 2:
        raise RetrievalError("feature extractor returned the wrong embedding shape")
    if not np.isfinite(array).all():
        raise RetrievalError("feature extractor returned a non-finite embedding")
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    if np.any(norms <= 0):
        raise RetrievalError("feature extractor returned a zero embedding")
    return array / norms


def rank_candidate_rotations(
    query_embeddings: np.ndarray,
    candidate_embeddings: np.ndarray,
    candidate_names: Sequence[str],
    top_k: int,
) -> list[list[dict[str, Any]]]:
    if top_k < 1:
        raise RetrievalError("top-k must be positive")
    if len(set(candidate_names)) != len(candidate_names):
        raise RetrievalError("candidate names must be unique")
    queries = _normalise_embeddings(query_embeddings, len(query_embeddings))
    candidates = _normalise_embeddings(candidate_embeddings, len(candidate_embeddings))
    expected_candidate_rows = len(candidate_names) * 4
    if candidates.shape[0] != expected_candidate_rows:
        raise RetrievalError("candidate embeddings must contain four rotations per image")
    if queries.shape[1] != candidates.shape[1]:
        raise RetrievalError("query and candidate embedding dimensions differ")
    scores = queries @ candidates.T
    ranked_queries: list[list[dict[str, Any]]] = []
    for query_index in range(queries.shape[0]):
        best_per_image: list[tuple[float, str, int]] = []
        for image_index, name in enumerate(candidate_names):
            rotation_scores = scores[
                query_index, image_index * 4 : image_index * 4 + 4
            ]
            best_rotation = min(
                range(4), key=lambda turn: (-float(rotation_scores[turn]), turn)
            )
            best_per_image.append(
                (float(rotation_scores[best_rotation]), name, best_rotation)
            )
        best_per_image.sort(key=lambda row: (-row[0], row[1], row[2]))
        ranked_queries.append(
            [
                {
                    "rank": rank,
                    "candidateName": name,
                    "quarterTurnsClockwise": turns,
                    "rotationDegreesClockwise": turns * 90,
                    "cosineSimilarity": round(score, 6),
                }
                for rank, (score, name, turns) in enumerate(
                    best_per_image[: min(top_k, len(best_per_image))], start=1
                )
            ]
        )
    return ranked_queries


def _image_evidence(image: BoundImage) -> dict[str, Any]:
    return {
        "name": image.name,
        "sizeBytes": image.size_bytes,
        "sha256": image.sha256,
        "pixelDimensions": [image.width, image.height],
        "fileFormat": image.file_format,
    }


def _verify_report_receipt(report: dict[str, Any]) -> str:
    evidence = report.get("evidenceBinding")
    if not isinstance(evidence, dict):
        raise RetrievalError("report has no evidenceBinding object")
    receipt = evidence.get("reportReceipt")
    if not isinstance(receipt, dict) or receipt.get("algorithm") != "SHA-256":
        raise RetrievalError("report has no supported receipt")
    supplied = receipt.get("sha256")
    if not isinstance(supplied, str) or SHA256.fullmatch(supplied) is None:
        raise RetrievalError("report receipt is not a SHA-256 value")
    unsigned = copy.deepcopy(report)
    unsigned["evidenceBinding"].pop("reportReceipt", None)
    expected = _canonical_sha256(unsigned)
    if supplied.upper() != expected:
        raise RetrievalError("report receipt does not match the report")
    return expected


def _font_path() -> Path | None:
    candidates = (
        Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "segoeui.ttf",
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/dejavu/DejaVuSans.ttf"),
    )
    return next((path.resolve() for path in candidates if path.is_file()), None)


def _font(size: int) -> ImageFont.ImageFont:
    path = _font_path()
    return ImageFont.truetype(str(path), size) if path else ImageFont.load_default()


def _contain(image: Image.Image, width: int, height: int) -> Image.Image:
    rgb = image.convert("RGB")
    scale = min(width / rgb.width, height / rgb.height)
    target = (
        max(1, round(rgb.width * scale)),
        max(1, round(rgb.height * scale)),
    )
    resized = rgb.resize(target, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), (27, 31, 38))
    canvas.paste(resized, ((width - target[0]) // 2, (height - target[1]) // 2))
    return canvas


def _review_state_label(value: Any) -> tuple[str, tuple[int, int, int]]:
    if value == "provisionally_quarantined_from_derived_panorama_screening":
        return "QUARANTINED - native image review required", (165, 40, 34)
    if value == "not_cleared_native_review_required":
        return "NOT CLEARED - native image review required", (113, 77, 18)
    return "UNKNOWN REVIEW STATE - do not use", (165, 40, 34)


def _draw_match_board(
    query: BoundImage,
    view: str,
    matches: Sequence[dict[str, Any]],
    candidates: dict[str, BoundImage],
    report_receipt: str,
    destination: Path,
) -> None:
    width, height = 1800, 720
    paper, ink, muted = (247, 248, 250), (26, 31, 38), (78, 88, 99)
    canvas = Image.new("RGB", (width, height), paper)
    draw = ImageDraw.Draw(canvas)
    title_font, label_font, note_font, status_font = (
        _font(28),
        _font(20),
        _font(17),
        _font(14),
    )
    draw.text((24, 18), f"Reception Room visual retrieval - {view}", fill=ink, font=title_font)
    draw.text(
        (24, 55),
        "PRIVATE - DO NOT PUBLISH. Search aid only: not pose, calibration, physical truth, or approval.",
        fill=(137, 53, 30),
        font=note_font,
    )
    panel_top, panel_height = 100, 500
    with Image.open(io.BytesIO(query.data)) as source:
        source.load()
        query_panel = _contain(source, 560, panel_height)
    canvas.paste(query_panel, (24, panel_top))
    draw.text((24, 610), "Rendered query", fill=ink, font=label_font)
    draw.text((24, 641), query.name, fill=muted, font=note_font)
    candidate_width = 380
    for index, match in enumerate(matches[:3]):
        candidate = candidates[match["candidateName"]]
        with Image.open(io.BytesIO(candidate.data)) as source:
            source.load()
            rotated = rotate_quarter_turns(source, match["quarterTurnsClockwise"])
            panel = _contain(rotated, candidate_width, panel_height)
        left = 610 + index * 395
        canvas.paste(panel, (left, panel_top))
        draw.text(
            (left, 610),
            f"#{match['rank']}  similarity {match['cosineSimilarity']:.6f}",
            fill=ink,
            font=label_font,
        )
        draw.text(
            (left, 641),
            f"{candidate.name}; rotate {match['rotationDegreesClockwise']} deg clockwise",
            fill=muted,
            font=note_font,
        )
        review_label, review_colour = _review_state_label(
            match.get("visualReviewState")
        )
        draw.text(
            (left, 674),
            review_label,
            fill=review_colour,
            font=status_font,
        )
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("resultType", RESULT_TYPE)
    metadata.add_text("privateData", "true")
    metadata.add_text("reportReceiptSha256", report_receipt)
    metadata.add_text("querySha256", query.sha256)
    metadata.add_text(
        "candidateReviewStates",
        json.dumps(
            [match.get("visualReviewState") for match in matches[:3]],
            ensure_ascii=False,
            separators=(",", ":"),
        ),
    )
    metadata.add_text("reviewStateLabelsRendered", "true")
    canvas.save(destination, format="PNG", pnginfo=metadata, optimize=False, compress_level=9)


def _markdown(report: dict[str, Any], board_rows: Sequence[dict[str, Any]]) -> str:
    lines = [
        "# Reception Room visual reference retrieval",
        "",
        "This private bundle uses computer vision to find E57-derived photographs that look like each rendered fixed view.",
        "",
        "## How to read it",
        "",
        "- The left image on each board is the rendered query.",
        "- The next three images are the strongest visual search results after trying all four quarter-turns.",
        "- A larger similarity means only that the configured image-feature extractor found the images visually alike.",
        "- Every candidate still needs native review. Quarantined candidates are visibly labelled in red.",
        "- It does **not** prove the camera pose, scale, calibration, room crop, geometry, privacy clearance, rights, or training permission.",
        "",
        "## Boards",
        "",
    ]
    for row in board_rows:
        top = row["topMatch"]
        lines.append(
            f"- [{row['view']}]({row['file']}) - first hypothesis: `{top['candidateName']}`, rotate {top['rotationDegreesClockwise']} degrees clockwise, similarity {top['cosineSimilarity']:.6f}."
        )
    lines.extend(
        [
            "",
            "## Required next check",
            "",
            "A proposed match must be tested against the E57 geometry and the exact camera model before it can be used as a measured reference. The frozen geometry held-out result remains failed and is not changed by this search bundle.",
            "",
            f"Report receipt: `{report['evidenceBinding']['reportReceipt']['sha256']}`",
            "",
        ]
    )
    return "\n".join(lines)


def build_retrieval_bundle(
    query_root: Path,
    capture_manifest: Path,
    query_variant: str,
    candidate_root: Path,
    e57_audit: Path,
    geometry_heldout_report: Path,
    scan_ids: Sequence[int],
    output_root: Path,
    extractor: FeatureExtractor,
    top_k: int = 10,
    *,
    allow_test_extractor: bool = False,
) -> dict[str, Any]:
    if not scan_ids:
        raise RetrievalError("at least one scan is required")
    if top_k < 3 or top_k > 100:
        raise RetrievalError("top-k must be between 3 and 100")
    output = output_root.absolute()
    if output.exists():
        raise RetrievalError("output folder already exists; choose a new folder")
    parent = output.parent.resolve(strict=True)

    test_only_extractor = type(extractor) is not AlexNetFc7Extractor
    if test_only_extractor and not allow_test_extractor:
        raise RetrievalError(
            "production bundles require the pinned AlexNet extractor; "
            "test extractors require an explicit test-only override"
        )
    model_evidence = copy.deepcopy(extractor.evidence)
    if not isinstance(model_evidence, dict):
        raise RetrievalError("feature extractor evidence must be an object")
    if test_only_extractor:
        tool_source_evidence = _capture_tool_source()
    else:
        _validate_pinned_model_evidence(model_evidence)
        tool_source_evidence = extractor.tool_source_evidence
    _verify_tool_source_still_matches(tool_source_evidence)

    queries, manifest_evidence = bind_query_images(
        query_root, capture_manifest, query_variant
    )
    candidates, derivation_evidence = bind_candidate_images(candidate_root, scan_ids)
    e57_audit_evidence, candidate_review_states = bind_e57_audit(
        e57_audit, scan_ids, candidates
    )
    geometry_heldout_evidence = bind_geometry_heldout_report(
        geometry_heldout_report
    )
    query_tasks = [EmbeddingTask(image) for image in queries]
    candidate_tasks = [
        EmbeddingTask(image, turns) for image in candidates for turns in range(4)
    ]
    query_embeddings = extractor.extract(query_tasks)
    candidate_embeddings = extractor.extract(candidate_tasks)
    _verify_tool_source_still_matches(tool_source_evidence)
    if extractor.evidence != model_evidence:
        raise RetrievalError("feature extractor evidence changed during execution")
    complete_rankings = rank_candidate_rotations(
        query_embeddings,
        candidate_embeddings,
        [image.name for image in candidates],
        len(candidates),
    )

    matches: list[dict[str, Any]] = []
    for view, query, rows in zip(
        QUERY_VIEWS, queries, complete_rankings, strict=True
    ):
        enriched_rows = [
            {
                **row,
                "visualReviewState": candidate_review_states[row["candidateName"]],
            }
            for row in rows
        ]
        margin = round(
            enriched_rows[0]["cosineSimilarity"]
            - enriched_rows[1]["cosineSimilarity"],
            6,
        )
        matches.append(
            {
                "view": view,
                "queryName": query.name,
                "assessment": (
                    "ambiguous_shortlist" if margin <= 0.01 else "ranked_for_human_review"
                ),
                "rankings": enriched_rows,
                "humanReviewTopK": top_k,
                "topTwoSimilarityMargin": margin,
                "interpretation": "retrieval hypotheses requiring independent geometry review",
            }
        )

    report: dict[str, Any] = {
        "schemaVersion": REPORT_SCHEMA,
        "resultType": RESULT_TYPE,
        "testOnlyExtractor": test_only_extractor,
        "authority": {
            "level": "none",
            "permits": ["private visual-search hypotheses for later review"],
            "forbids": [
                "camera-pose or calibration claims",
                "physical-accuracy or quality acceptance",
                "materialisation, reconstruction, or training permission",
                "privacy or rights clearance",
                "publication or production registration",
            ],
        },
        "decisions": {
            "matchEstablished": False,
            "poseBindingPermitted": False,
            "metricUsePermitted": False,
            "trainingPermitted": False,
            "reconstructionInputPermitted": False,
            "privacyCleared": False,
            "rightsCleared": False,
            "publicationPermitted": False,
            "productionRegistrationPermitted": False,
        },
        "method": {
            "queryVariant": query_variant,
            "queryViews": list(QUERY_VIEWS),
            "candidateScanIds": list(scan_ids),
            "candidateFacesPerScan": list(FACE_NAMES),
            "quarterTurnsClockwise": [0, 1, 2, 3],
            "ranking": (
                "cosine similarity of L2-normalised features; choose the strongest "
                "rotation for each image; order by descending similarity, then basename, "
                "then rotation"
            ),
            "storedRankingCountPerView": len(candidates),
            "humanReviewTopK": top_k,
            "productionExtractorRequiredByDefault": True,
        },
        "model": model_evidence,
        "queries": [_image_evidence(image) for image in queries],
        "candidates": [
            {
                **_image_evidence(image),
                "visualReviewState": candidate_review_states[image.name],
            }
            for image in candidates
        ],
        "matches": matches,
        "limitations": [
            "The candidate JPEGs are derived cube images, not proven sensor-original photographs.",
            "Their loose face labels are untrusted; quarter-turn recovery does not repair camera-pose authority.",
            "A semantic image embedding can prefer similar ceilings, floors, doors, or colours for the wrong physical view.",
            "The six rendered views share one optical centre and are not an independent physical reference.",
            "The frozen colour-blind E57 geometry held-out result remains REJECT_GEOMETRY_MISMATCH (82 of 96 images passed).",
            "No image is privacy-cleared or rights-authorised by this command.",
        ],
        "evidenceBinding": {
            "captureManifest": manifest_evidence,
            "e57ImageAudit": e57_audit_evidence,
            "geometryEdgeHeldout": geometry_heldout_evidence,
            "candidateDerivationReport": derivation_evidence,
            "toolSource": tool_source_evidence,
            "runtime": {
                "python": platform.python_version(),
                "implementation": platform.python_implementation(),
                "platformSystem": platform.system(),
                "platformRelease": platform.release(),
                "machine": platform.machine(),
                "numpy": np.__version__,
                "Pillow": Image.__version__,
            },
            "receiptCanonicalization": (
                "UTF-8 JSON with sorted keys, compact separators, no NaN; scope is "
                "the complete report before evidenceBinding.reportReceipt is inserted"
            ),
        },
    }
    report["evidenceBinding"]["reportReceipt"] = {
        "algorithm": "SHA-256",
        "sha256": _canonical_sha256(report),
    }
    report_receipt = _verify_report_receipt(report)

    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.partial-", dir=parent))
    try:
        report_bytes = (
            json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
            + "\n"
        ).encode("utf-8")
        (temporary / "report.json").write_bytes(report_bytes)
        boards = temporary / "boards"
        boards.mkdir()
        candidates_by_name = {image.name: image for image in candidates}
        board_rows: list[dict[str, Any]] = []
        for view, query, match in zip(QUERY_VIEWS, queries, matches, strict=True):
            rows = match["rankings"]
            filename = f"match--{view}.png"
            destination = boards / filename
            _draw_match_board(
                query,
                view,
                rows,
                candidates_by_name,
                report_receipt,
                destination,
            )
            board_rows.append(
                {
                    "view": view,
                    "file": f"boards/{filename}",
                    "sizeBytes": destination.stat().st_size,
                    "sha256": _sha256_file(destination),
                    "topMatch": rows[0],
                }
            )
        font_path = _font_path()
        readme_text = _markdown(report, board_rows)
        warning_text = (
            "PRIVATE VENUE PIXELS. DO NOT COMMIT OR PUBLISH.\n"
            "This bundle is an authority-none computer-vision search aid.\n"
        )
        index: dict[str, Any] = {
            "schemaVersion": INDEX_SCHEMA,
            "resultType": RESULT_TYPE,
            "privateData": True,
            "sourceReport": {
                "name": "report.json",
                "sizeBytes": len(report_bytes),
                "sha256": _sha256_bytes(report_bytes),
                "receiptSha256": report_receipt,
            },
            "renderFont": (
                {
                    "name": font_path.name,
                    "sizeBytes": font_path.stat().st_size,
                    "sha256": _sha256_file(font_path),
                }
                if font_path
                else {"name": "Pillow-default"}
            ),
            "boards": board_rows,
            "supportFiles": [
                {
                    "name": "README.md",
                    "sizeBytes": len(readme_text.encode("utf-8")),
                    "sha256": _sha256_bytes(readme_text.encode("utf-8")),
                },
                {
                    "name": "PRIVATE-DATA-WARNING.txt",
                    "sizeBytes": len(warning_text.encode("utf-8")),
                    "sha256": _sha256_bytes(warning_text.encode("utf-8")),
                },
            ],
            "warning": (
                "Private venue pixels. Do not publish. Visual retrieval is not pose, "
                "calibration, physical truth, rights clearance, or acceptance."
            ),
        }
        index["indexReceipt"] = {
            "algorithm": "SHA-256",
            "sha256": _canonical_sha256(index),
        }
        (temporary / "index.json").write_text(
            json.dumps(index, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False)
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
        (temporary / "README.md").write_text(
            readme_text, encoding="utf-8", newline="\n"
        )
        (temporary / "PRIVATE-DATA-WARNING.txt").write_text(
            warning_text, encoding="utf-8", newline="\n"
        )
        _verify_tool_source_still_matches(tool_source_evidence)
        if extractor.evidence != model_evidence:
            raise RetrievalError("feature extractor evidence changed before publication")
        os.replace(temporary, output)
    except Exception:
        if temporary.exists():
            shutil.rmtree(temporary)
        raise
    return index


def _verify_index_receipt(index: dict[str, Any]) -> str:
    receipt = index.get("indexReceipt")
    if not isinstance(receipt, dict) or receipt.get("algorithm") != "SHA-256":
        raise RetrievalError("bundle index has no supported receipt")
    supplied = receipt.get("sha256")
    if not isinstance(supplied, str) or SHA256.fullmatch(supplied) is None:
        raise RetrievalError("bundle index receipt is not a SHA-256 value")
    unsigned = copy.deepcopy(index)
    unsigned.pop("indexReceipt", None)
    expected = _canonical_sha256(unsigned)
    if supplied.upper() != expected:
        raise RetrievalError("bundle index receipt does not match the index")
    return expected


def _regular_bundle_file(root: Path, relative: str) -> Path:
    parts = Path(relative).parts
    if (
        not parts
        or Path(relative).is_absolute()
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise RetrievalError(f"unsafe bundle-relative path: {relative!r}")
    unresolved = root.joinpath(*parts)
    if _is_link_like(unresolved):
        raise RetrievalError(f"symbolic-link bundle file is not accepted: {relative}")
    resolved = unresolved.resolve(strict=True)
    if root not in resolved.parents or not resolved.is_file():
        raise RetrievalError(f"bundle path escapes its root: {relative}")
    return resolved


def verify_retrieval_bundle(
    bundle_root: Path, *, allow_test_bundle: bool = False
) -> dict[str, Any]:
    """Re-read and verify every file in one generated retrieval bundle."""

    root = bundle_root.resolve(strict=True)
    if _is_link_like(bundle_root) or not root.is_dir():
        raise RetrievalError("bundle root must be a regular directory")
    index_path = _regular_bundle_file(root, "index.json")
    report_path = _regular_bundle_file(root, "report.json")
    index_bytes = index_path.read_bytes()
    report_bytes = report_path.read_bytes()
    index = _strict_json(index_bytes, "bundle index")
    report = _strict_json(report_bytes, "retrieval report")
    if index.get("schemaVersion") != INDEX_SCHEMA or report.get("schemaVersion") != REPORT_SCHEMA:
        raise RetrievalError("bundle contains an unsupported schema")
    if index.get("resultType") != RESULT_TYPE or report.get("resultType") != RESULT_TYPE:
        raise RetrievalError("bundle contains an unsupported result type")
    if index.get("privateData") is not True:
        raise RetrievalError("bundle must retain its private-data warning")
    index_receipt = _verify_index_receipt(index)
    report_receipt = _verify_report_receipt(report)
    authority = report.get("authority")
    if not isinstance(authority, dict) or authority.get("level") != "none":
        raise RetrievalError("retrieval report must remain authority-none")
    decisions = report.get("decisions")
    expected_decisions = {
        "matchEstablished",
        "poseBindingPermitted",
        "metricUsePermitted",
        "trainingPermitted",
        "reconstructionInputPermitted",
        "privacyCleared",
        "rightsCleared",
        "publicationPermitted",
        "productionRegistrationPermitted",
    }
    if (
        not isinstance(decisions, dict)
        or set(decisions) != expected_decisions
        or any(value is not False for value in decisions.values())
    ):
        raise RetrievalError("retrieval decisions must all remain explicitly false")
    test_only_extractor = report.get("testOnlyExtractor")
    if not isinstance(test_only_extractor, bool):
        raise RetrievalError("retrieval report has no extractor-enforcement state")
    if test_only_extractor and not allow_test_bundle:
        raise RetrievalError("test-extractor bundles are not production-verifiable")
    model = report.get("model")
    if test_only_extractor:
        if not isinstance(model, dict):
            raise RetrievalError("test-extractor bundle has no model evidence")
    else:
        _validate_pinned_model_evidence(model)

    source_report = index.get("sourceReport")
    if not isinstance(source_report, dict) or source_report != {
        "name": "report.json",
        "sizeBytes": len(report_bytes),
        "sha256": _sha256_bytes(report_bytes),
        "receiptSha256": report_receipt,
    }:
        raise RetrievalError("bundle index does not bind the exact report bytes")

    evidence_binding = report.get("evidenceBinding")
    if not isinstance(evidence_binding, dict):
        raise RetrievalError("retrieval report has no evidence binding")
    tool = evidence_binding.get("toolSource")
    if not isinstance(tool, dict) or tool != _capture_tool_source():
        raise RetrievalError("report is not bound to the current retrieval tool source")

    report_matches = report.get("matches")
    queries = report.get("queries")
    if not isinstance(report_matches, list) or not isinstance(queries, list):
        raise RetrievalError("retrieval report has malformed matches or queries")
    matches_by_view = {
        row.get("view"): row for row in report_matches if isinstance(row, dict)
    }
    queries_by_name = {
        row.get("name"): row for row in queries if isinstance(row, dict)
    }
    if (
        len(report_matches) != 6
        or len(queries) != 6
        or set(matches_by_view) != set(QUERY_VIEWS)
        or len(queries_by_name) != 6
    ):
        raise RetrievalError("retrieval report does not bind the six fixed views")

    boards = index.get("boards")
    if not isinstance(boards, list) or len(boards) != 6:
        raise RetrievalError("bundle index must bind six boards")
    board_views: set[str] = set()
    expected_files = {"index.json", "report.json"}
    for row in boards:
        if not isinstance(row, dict):
            raise RetrievalError("bundle index has a malformed board record")
        view, relative = row.get("view"), row.get("file")
        if view not in QUERY_VIEWS or view in board_views:
            raise RetrievalError("bundle index has an invalid or repeated board view")
        expected_relative = f"boards/match--{view}.png"
        if relative != expected_relative:
            raise RetrievalError("bundle index has an unexpected board path")
        board_views.add(view)
        expected_files.add(expected_relative)
        board_path = _regular_bundle_file(root, expected_relative)
        board_bytes = board_path.read_bytes()
        match = matches_by_view[view]
        rankings = match.get("rankings")
        if not isinstance(rankings, list) or not rankings or row.get("topMatch") != rankings[0]:
            raise RetrievalError("board top-match record differs from the report")
        if any(
            not isinstance(ranking, dict)
            or ranking.get("visualReviewState")
            not in {
                "not_cleared_native_review_required",
                "provisionally_quarantined_from_derived_panorama_screening",
            }
            for ranking in rankings
        ):
            raise RetrievalError("retrieval ranking has an unsupported visual-review state")
        expected_board_record = {
            "view": view,
            "file": expected_relative,
            "sizeBytes": len(board_bytes),
            "sha256": _sha256_bytes(board_bytes),
            "topMatch": rankings[0],
        }
        if row != expected_board_record:
            raise RetrievalError(f"bundle index does not bind board bytes: {view}")
        try:
            with Image.open(io.BytesIO(board_bytes)) as image:
                if image.format != "PNG" or image.size != (1800, 720):
                    raise RetrievalError(f"bundle board has an unexpected raster: {view}")
                info = dict(image.info)
                image.load()
        except RetrievalError:
            raise
        except (OSError, ValueError) as error:
            raise RetrievalError(f"bundle board cannot be decoded: {view}") from error
        query = queries_by_name.get(match.get("queryName"))
        if not isinstance(query, dict):
            raise RetrievalError(f"bundle board has no bound query: {view}")
        if (
            info.get("resultType") != RESULT_TYPE
            or info.get("privateData") != "true"
            or info.get("reportReceiptSha256") != report_receipt
            or info.get("querySha256") != query.get("sha256")
            or info.get("candidateReviewStates")
            != json.dumps(
                [ranking["visualReviewState"] for ranking in rankings[:3]],
                ensure_ascii=False,
                separators=(",", ":"),
            )
            or info.get("reviewStateLabelsRendered") != "true"
        ):
            raise RetrievalError(f"bundle board metadata is stale: {view}")

    support_files = index.get("supportFiles")
    if not isinstance(support_files, list) or len(support_files) != 2:
        raise RetrievalError("bundle index must bind both support files")
    support_names = [
        row.get("name") if isinstance(row, dict) else None for row in support_files
    ]
    if set(support_names) != {"README.md", "PRIVATE-DATA-WARNING.txt"}:
        raise RetrievalError("bundle index must bind each support file exactly once")
    for row in support_files:
        if not isinstance(row, dict) or row.get("name") not in {
            "README.md",
            "PRIVATE-DATA-WARNING.txt",
        }:
            raise RetrievalError("bundle index has an invalid support-file record")
        name = row["name"]
        expected_files.add(name)
        data = _regular_bundle_file(root, name).read_bytes()
        if row != {
            "name": name,
            "sizeBytes": len(data),
            "sha256": _sha256_bytes(data),
        }:
            raise RetrievalError(f"bundle index does not bind support file: {name}")

    actual_files: set[str] = set()
    for path in root.rglob("*"):
        if _is_link_like(path):
            raise RetrievalError("bundle contains a symbolic link")
        if path.is_file():
            actual_files.add(path.relative_to(root).as_posix())
    if actual_files != expected_files:
        raise RetrievalError("bundle contains a missing or unexpected file")
    return {
        "schemaVersion": INDEX_SCHEMA,
        "authority": "none",
        "filesVerified": len(actual_files),
        "boardsVerified": 6,
        "reportReceipt": report_receipt,
        "indexReceipt": index_receipt,
        "allDecisionsFalse": True,
        "productionExtractorVerified": not test_only_extractor,
        "status": "verified_private_visual_shortlist_not_pose_or_acceptance",
    }


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Privately rank E57-derived cube images against six fixed Reception renders."
        )
    )
    parser.add_argument("--query-root", required=True, type=Path)
    parser.add_argument("--capture-manifest", required=True, type=Path)
    parser.add_argument("--query-variant", default="quality-sh3-ply")
    parser.add_argument("--candidate-root", required=True, type=Path)
    parser.add_argument(
        "--e57-audit",
        required=True,
        type=Path,
        help="authority-none E57 room-image audit that binds every cube-face byte",
    )
    parser.add_argument(
        "--geometry-heldout-report",
        required=True,
        type=Path,
        help="frozen negative XYZ-only geometry held-out report",
    )
    parser.add_argument("--scans", default="122-144")
    parser.add_argument("--model-weights", required=True, type=Path)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        scan_ids = parse_scan_range(args.scans)
        extractor = AlexNetFc7Extractor(
            args.model_weights,
            PINNED_ALEXNET_SHA256,
            args.device,
            args.batch_size,
        )
        result = build_retrieval_bundle(
            args.query_root,
            args.capture_manifest,
            args.query_variant,
            args.candidate_root,
            args.e57_audit,
            args.geometry_heldout_report,
            scan_ids,
            args.output,
            extractor,
            args.top_k,
        )
    except (RetrievalError, FileNotFoundError, NotADirectoryError, OSError) as error:
        parser.exit(2, f"error: {error}\n")
    print(
        json.dumps(
            {
                "output": str(args.output),
                "boards": len(result["boards"]),
                "reportReceipt": result["sourceReport"]["receiptSha256"],
                "authority": "none",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
