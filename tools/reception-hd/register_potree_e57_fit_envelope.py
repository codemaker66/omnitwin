#!/usr/bin/env python3
"""Fit-only Reception Potree-to-E57 diagnostic using an accepted room envelope.

This consumer is deliberately separate from the existing fit/validation
diagnostic.  It verifies one digest-bound TypeScript room-envelope review,
requests only the frozen fit E57 stations, performs an initial proper/mirror
fit, crops inverse-mapped fit samples in decoder coordinates, and refits both
handedness families.  Its only output is one create-only, authority-none
candidate or refusal receipt.  It cannot approve or register a transform.
"""

from __future__ import annotations

import argparse
import copy
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import platform
import re
import sys
from typing import Any, Sequence
import unicodedata

import align_e57_xgrids as alignment
import register_potree_e57 as registration


SCHEMA_VERSION = "omnitwin.reception.potree-e57-fit-envelope-diagnostic.v0"
RECEIPT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_POTREE_E57_FIT_ENVELOPE_V0\0"
RECEIPT_DIGEST_DOMAIN_LABEL = "OMNITWIN_RECEPTION_POTREE_E57_FIT_ENVELOPE_V0\\0"

ROOM_REVIEW_SCHEMA_VERSION = "omnitwin.foundry.room-envelope-review.v0"
ROOM_REVIEW_DIGEST_DOMAIN = b"OMNITWIN_FOUNDRY_ROOM_ENVELOPE_REVIEW_V0\0"
POTREE_BUNDLE_DIGEST_DOMAIN = b"VENVIEWER_FOUNDRY_POTREE_V2_BUNDLE_V7\0"
ROOM_MAPPING_PROFILE = "potree_v2_v8_intrinsic_pixel_to_decoder_coordinates_v0"
ROOM_MAPPING_Y_AXIS_RULE = "raw_y_floor_then_height_minus_one"
ROOM_REVIEW_MAX_BYTES = 2 * 1024 * 1024
ROOM_REVIEW_MIN_INCLUDED_RECORDS = 512
ROOM_REVIEW_MIN_POLYGON_AREA_PIXELS = 64.0
ROOM_REVIEW_MAX_VERTICES = 64
ROOM_PREVIEW_WIDTH = 1024
ROOM_PREVIEW_HEIGHT = 1024
ROOM_PREVIEW_MARGIN = 32

RECEPTION_POTREE_BUNDLE_SHA256 = (
    "f226739d3f8e94605b8c363a1b135986388b5cf920df0194ff960bfed5940fb2"
)
RECEPTION_E57_SIZE_BYTES = registration.RECEPTION_E57_SIZE_BYTES
RECEPTION_E57_SHA256 = registration.RECEPTION_E57_SHA256

FIT_SCAN_IDS = registration.FIT_SCAN_IDS
VALIDATION_SCAN_IDS = registration.VALIDATION_SCAN_IDS
FROZEN_TEST_SCAN_IDS = registration.FROZEN_TEST_SCAN_IDS
QUARANTINED_SCAN_IDS = registration.QUARANTINED_SCAN_IDS
ALL_NON_FIT_SCAN_IDS = frozenset(
    VALIDATION_SCAN_IDS + FROZEN_TEST_SCAN_IDS + QUARANTINED_SCAN_IDS
)

MEMBER_SPECS = (
    ("metadata", "metadata.json"),
    ("hierarchy", "hierarchy.bin"),
    ("octree", "octree.bin"),
)
PREVIEW_SPECS = (
    ("position_0_1", (0, 1), 2),
    ("position_0_2", (0, 2), 1),
    ("position_1_2", (1, 2), 0),
)
PREVIEW_MODES = frozenset(
    ("omitted_component", "intensity_byte", "opaque_vendor_byte", "record_density")
)
RECEPTION_PREVIEW_PINS = {
    "position_0_1": {
        "mode": "record_density",
        "fileName": "potree-v2-position_0_1-record_density.png",
        "sha256": "7cc169a071215e15448001e530ebc705f03ecff4b0cb843ab9cc4bb09677586d",
        "pixelSha256": "9490e837461be4f9e2adc6e933e7ef41af3a99b383034616403b971003f0b343",
    },
    "position_0_2": {
        "mode": "record_density",
        "fileName": "potree-v2-position_0_2-record_density.png",
        "sha256": "a48887c8e605a97fbb5951d4d73c351420d83e643674ee4f1f840d1dc57870d9",
        "pixelSha256": "060290ff4bf3afebf34f6ec9b5845b6ed256337be55e4cae3141cb6b5fbaa5aa",
    },
    "position_1_2": {
        "mode": "record_density",
        "fileName": "potree-v2-position_1_2-record_density.png",
        "sha256": "e07b935f17805838265d9e5e9ddd1c76d4adf15d072712dd0e4ff16d697e2637",
        "pixelSha256": "6b661fb2c01e54d8ca8d4cbd332156929ca668a36ac5f3e7286ef976aba59c12",
    },
}
ROOM_REVIEW_LIMITATIONS = (
    "OPERATOR_SELECTION_DOES_NOT_ESTABLISH_UNITS_AXES_FRAME_CRS_ROOM_IDENTITY_OR_PHYSICAL_ACCURACY",
    "THE_POLYGON_IS_A_FIT_SEED_ONLY_AND_IS_NOT_VALIDATION_INDEPENDENT_CONTROL_OR_TRANSFORM_AUTHORITY",
    "PIXEL_TO_DECODER_INVERSION_USES_THE_FROZEN_V8_DIAGNOSTIC_RASTER_MAPPING_AND_DOES_NOT_ADD_SOURCE_PRECISION",
    "PURPOSE_SCOPED_RIGHTS_AND PRODUCER_LINEAGE_REMAIN_UNREVIEWED",
)

_RFC3339_UTC = re.compile(
    r"^(?:[0-9]{4})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
    r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?Z$"
)
_SAFE_INTEGER_MAX = 9_007_199_254_740_991
_WINDOWS_DEVICE = re.compile(r"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$")


@dataclass(frozen=True)
class RoomReviewBundle:
    path: Path
    snapshot: alignment.FileSnapshot
    file_sha256: str
    document: dict[str, Any]


class _ExactFitScanScopeAdapter:
    """Reject any raw adapter result or helper request outside FIT_SCAN_IDS."""

    def __init__(self, delegate: Any) -> None:
        self._delegate = delegate

    @staticmethod
    def _scan_id(raw: Any, field: str) -> int:
        if isinstance(raw, bool):
            fail("E57_ADAPTER_SCAN_SCOPE_MISMATCH", f"{field} contains a boolean scan key")
        if isinstance(raw, int):
            return raw
        if isinstance(raw, str) and raw and raw == str(int(raw, 10)):
            return int(raw, 10)
        fail("E57_ADAPTER_SCAN_SCOPE_MISMATCH", f"{field} contains a non-canonical scan key")
        raise AssertionError("unreachable")

    @classmethod
    def _normalized_keys(cls, value: Any, field: str) -> set[int]:
        if not isinstance(value, dict):
            fail("INVALID_E57_ADAPTER", f"E57 point adapter {field} must be an object")
        normalized: set[int] = set()
        for raw in value:
            try:
                scan_id = cls._scan_id(raw, field)
            except ValueError:
                fail(
                    "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                    f"{field} contains a non-canonical scan key",
                )
            if scan_id in normalized:
                fail(
                    "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                    f"{field} contains duplicate representations of scan {scan_id}",
                )
            normalized.add(scan_id)
        return normalized

    def read_samples(
        self, path: Path, scan_ids: Sequence[int], per_scan_limit: int
    ) -> dict[str, Any]:
        requested = tuple(scan_ids)
        if requested != FIT_SCAN_IDS:
            fail(
                "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                "fit-envelope consumer requested a scan set other than exact FIT_SCAN_IDS",
            )
        result = self._delegate.read_samples(path, requested, per_scan_limit)
        if not isinstance(result, dict):
            fail("INVALID_E57_ADAPTER", "E57 point adapter returned a non-object result")
        expected = set(FIT_SCAN_IDS)
        if self._normalized_keys(result.get("pointsByScan"), "pointsByScan") != expected:
            fail(
                "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                "pointsByScan keys differ from exact FIT_SCAN_IDS",
            )
        for field in ("rawPointCounts", "organizedSampling"):
            value = result.get(field)
            if value is not None and not self._normalized_keys(value, field).issubset(expected):
                fail(
                    "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                    f"{field} contains a scan outside exact FIT_SCAN_IDS",
                )
        return result


def fail(code: str, message: str) -> None:
    alignment.fail(code, message)


def _object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} must be an object")
    alignment._require_exact_keys(value, keys, label)
    return value


def _array(value: Any, label: str, *, minimum: int = 0, maximum: int | None = None) -> list[Any]:
    if not isinstance(value, list):
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} must be an array")
    if len(value) < minimum or (maximum is not None and len(value) > maximum):
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} has an invalid length")
    return value


def _text(
    value: Any,
    label: str,
    *,
    minimum: int = 0,
    maximum: int,
    trimmed: bool = False,
) -> str:
    if not isinstance(value, str) or len(value) < minimum or len(value) > maximum:
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} must be a bounded string")
    if trimmed and value != value.strip():
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} must already be trimmed")
    return value


def _safe_int(value: Any, label: str, *, minimum: int = 0, maximum: int = _SAFE_INTEGER_MAX) -> int:
    parsed = alignment._require_int(value, label, minimum=minimum)
    if parsed > maximum:
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} exceeds the safe integer range")
    return parsed


def _finite(value: Any, label: str, *, positive: bool = False, nonnegative: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} must be a number")
    parsed = float(value)
    if not math.isfinite(parsed):
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} must be finite")
    if positive and parsed <= 0.0:
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} must be positive")
    if nonnegative and parsed < 0.0:
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} must be nonnegative")
    return parsed


def _vec(value: Any, length: int, label: str) -> list[float]:
    row = _array(value, label)
    if len(row) != length:
        fail("INVALID_ROOM_ENVELOPE_REVIEW", f"{label} must contain {length} numbers")
    return [_finite(item, f"{label}[{index}]") for index, item in enumerate(row)]


def _axis(value: Any, label: str) -> int:
    return _safe_int(value, label, maximum=2)


def _approximately_equal(left: float, right: float) -> bool:
    scale = max(1.0, abs(left), abs(right))
    return abs(left - right) <= scale * 1e-10


def _safe_foundry_relative_path(value: str) -> bool:
    if (
        value != value.strip()
        or value != unicodedata.normalize("NFC", value)
        or value.startswith("/")
        or re.match(r"^[A-Za-z]:", value)
        or "\\" in value
        or any(character in value for character in '<>:"|?*')
    ):
        return False
    for part in value.split("/"):
        stem = part.split(".", 1)[0].upper()
        if (
            part in ("", ".", "..")
            or part.endswith(".")
            or part.endswith(" ")
            or _WINDOWS_DEVICE.fullmatch(stem)
        ):
            return False
        for character in part:
            code = ord(character)
            if (
                code < 0x20
                or code == 0x7F
                or 0x80 <= code <= 0x9F
                or 0xD800 <= code <= 0xDFFF
                or 0x202A <= code <= 0x202E
                or 0x2066 <= code <= 0x2069
                or code == 0xFEFF
            ):
                return False
    return True


def _potree_bundle_digest(bundle_root: str, members: Sequence[dict[str, Any]]) -> str:
    digest_payload = {
        "bundleRoot": bundle_root,
        "members": [
            {
                "role": row["role"],
                "path": row["relativePath"],
                "sizeBytes": row["sizeBytes"],
                "sha256": row["sha256"],
            }
            for row in members
        ],
    }
    return hashlib.sha256(
        POTREE_BUNDLE_DIGEST_DOMAIN + alignment._canonical_json_bytes(digest_payload)
    ).hexdigest()


def _js_rounded_12(value: float) -> float:
    rounded = math.floor(value * 1_000_000_000_000.0 + 0.5) / 1_000_000_000_000.0
    return 0.0 if rounded == 0.0 else rounded


def _orientation(a: Sequence[float], b: Sequence[float], c: Sequence[float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _on_segment(a: Sequence[float], b: Sequence[float], point: Sequence[float]) -> bool:
    return (
        _orientation(a, b, point) == 0
        and min(a[0], b[0]) <= point[0] <= max(a[0], b[0])
        and min(a[1], b[1]) <= point[1] <= max(a[1], b[1])
    )


def _segments_intersect(
    a: Sequence[float], b: Sequence[float], c: Sequence[float], d: Sequence[float]
) -> bool:
    ab_c = _orientation(a, b, c)
    ab_d = _orientation(a, b, d)
    cd_a = _orientation(c, d, a)
    cd_b = _orientation(c, d, b)
    if (
        ((ab_c > 0 and ab_d < 0) or (ab_c < 0 and ab_d > 0))
        and ((cd_a > 0 and cd_b < 0) or (cd_a < 0 and cd_b > 0))
    ):
        return True
    return (
        (ab_c == 0 and _on_segment(a, b, c))
        or (ab_d == 0 and _on_segment(a, b, d))
        or (cd_a == 0 and _on_segment(c, d, a))
        or (cd_b == 0 and _on_segment(c, d, b))
    )


def _validate_simple_polygon(vertices: Sequence[Sequence[float]], label: str) -> None:
    if len({(point[0], point[1]) for point in vertices}) != len(vertices):
        fail("INVALID_ROOM_ENVELOPE_POLYGON", f"{label} vertices must be unique")
    twice_area = sum(
        vertices[index][0] * vertices[(index + 1) % len(vertices)][1]
        - vertices[(index + 1) % len(vertices)][0] * vertices[index][1]
        for index in range(len(vertices))
    )
    if abs(twice_area) / 2.0 < ROOM_REVIEW_MIN_POLYGON_AREA_PIXELS:
        fail("INVALID_ROOM_ENVELOPE_POLYGON", f"{label} area is too small")
    for left in range(len(vertices)):
        left_next = (left + 1) % len(vertices)
        for right in range(left + 1, len(vertices)):
            right_next = (right + 1) % len(vertices)
            if left_next == right or right_next == left:
                continue
            if _segments_intersect(
                vertices[left],
                vertices[left_next],
                vertices[right],
                vertices[right_next],
            ):
                fail("INVALID_ROOM_ENVELOPE_POLYGON", f"{label} edges must not intersect")


def _preview(value: Any, label: str) -> dict[str, Any]:
    row = _object(
        value,
        {
            "viewId",
            "mode",
            "fileName",
            "sha256",
            "pixelSha256",
            "width",
            "height",
            "projectedAxes",
            "omittedAxis",
        },
        label,
    )
    view_id = _text(row["viewId"], f"{label}.viewId", minimum=1, maximum=32)
    known = {item[0]: item for item in PREVIEW_SPECS}
    if view_id not in known:
        fail("INVALID_ROOM_ENVELOPE_PREVIEW", f"{label}.viewId is not canonical")
    mode = _text(row["mode"], f"{label}.mode", minimum=1, maximum=32)
    if mode not in PREVIEW_MODES:
        fail("INVALID_ROOM_ENVELOPE_PREVIEW", f"{label}.mode is unsupported")
    file_name = _text(row["fileName"], f"{label}.fileName", minimum=1, maximum=160)
    if file_name != f"potree-v2-{view_id}-{mode}.png":
        fail("INVALID_ROOM_ENVELOPE_PREVIEW", f"{label}.fileName is not canonical")
    alignment._require_sha256(row["sha256"], f"{label}.sha256")
    alignment._require_sha256(row["pixelSha256"], f"{label}.pixelSha256")
    if _safe_int(row["width"], f"{label}.width") != ROOM_PREVIEW_WIDTH:
        fail("INVALID_ROOM_ENVELOPE_PREVIEW", f"{label}.width must be 1024")
    if _safe_int(row["height"], f"{label}.height") != ROOM_PREVIEW_HEIGHT:
        fail("INVALID_ROOM_ENVELOPE_PREVIEW", f"{label}.height must be 1024")
    axes_raw = _array(row["projectedAxes"], f"{label}.projectedAxes")
    if len(axes_raw) != 2:
        fail("INVALID_ROOM_ENVELOPE_PREVIEW", f"{label}.projectedAxes must contain two axes")
    axes = (_axis(axes_raw[0], f"{label}.projectedAxes[0]"), _axis(axes_raw[1], f"{label}.projectedAxes[1]"))
    omitted = _axis(row["omittedAxis"], f"{label}.omittedAxis")
    expected = known[view_id]
    if axes != expected[1] or omitted != expected[2]:
        fail("INVALID_ROOM_ENVELOPE_PREVIEW", f"{label} axes contradict its viewId")
    return row


def _member(value: Any, label: str) -> dict[str, Any]:
    row = _object(value, {"role", "relativePath", "sizeBytes", "sha256"}, label)
    _text(row["role"], f"{label}.role", minimum=1, maximum=16)
    relative = _text(row["relativePath"], f"{label}.relativePath", minimum=1, maximum=1024)
    if "\\" in relative or PurePosixPath(relative).is_absolute() or ".." in PurePosixPath(relative).parts:
        fail("INVALID_ROOM_ENVELOPE_MEMBER", f"{label}.relativePath is unsafe")
    _safe_int(row["sizeBytes"], f"{label}.sizeBytes")
    alignment._require_sha256(row["sha256"], f"{label}.sha256")
    return row


def _parse_review_payload(payload: bytes, label: str) -> dict[str, Any]:
    return alignment._strict_json(payload, label)


def _validate_review_document(
    document: dict[str, Any],
    *,
    expected_bundle_sha256: str,
    expected_members: Sequence[dict[str, Any]] | None,
    require_accepted: bool,
) -> dict[str, Any]:
    top = _object(
        document,
        {
            "schemaVersion",
            "authority",
            "source",
            "review",
            "selection",
            "eligibility",
            "policy",
            "limitations",
            "reportSha256",
        },
        "room-envelope review",
    )
    if top["schemaVersion"] != ROOM_REVIEW_SCHEMA_VERSION or top["authority"] != "none":
        fail("INVALID_ROOM_ENVELOPE_REVIEW", "review schemaVersion or authority is invalid")
    report_sha = alignment._require_sha256(top["reportSha256"], "reportSha256")

    source = _object(
        top["source"],
        {
            "receiptSha256",
            "sourceFactsSha256",
            "bundleRoot",
            "bundleSha256",
            "members",
            "preview",
        },
        "source",
    )
    alignment._require_sha256(source["receiptSha256"], "source.receiptSha256")
    alignment._require_sha256(source["sourceFactsSha256"], "source.sourceFactsSha256")
    bundle_root = _text(source["bundleRoot"], "source.bundleRoot", maximum=4096)
    if bundle_root != "" and (
        len(bundle_root) > 2048 or not _safe_foundry_relative_path(bundle_root)
    ):
        fail(
            "INVALID_ROOM_ENVELOPE_MEMBER",
            "source.bundleRoot is not an empty or canonical Foundry relative path",
        )
    bundle_sha = alignment._require_sha256(source["bundleSha256"], "source.bundleSha256")
    expected_bundle = alignment._require_sha256(expected_bundle_sha256, "expected bundle SHA-256")
    if bundle_sha != expected_bundle:
        fail("ROOM_ENVELOPE_BUNDLE_MISMATCH", "review does not bind the expected Potree bundle")
    member_values = _array(source["members"], "source.members")
    if len(member_values) != len(MEMBER_SPECS):
        fail("INVALID_ROOM_ENVELOPE_MEMBER", "source.members must contain exactly three rows")
    members = [_member(value, f"source.members[{index}]") for index, value in enumerate(member_values)]
    for index, (role, leaf) in enumerate(MEMBER_SPECS):
        expected_relative = leaf if bundle_root == "" else f"{bundle_root}/{leaf}"
        if members[index]["role"] != role or members[index]["relativePath"] != expected_relative:
            fail("ROOM_ENVELOPE_MEMBER_MISMATCH", "bundle members must retain canonical role/path order")
    if _potree_bundle_digest(bundle_root, members) != bundle_sha:
        fail(
            "ROOM_ENVELOPE_BUNDLE_DIGEST_MISMATCH",
            "source.bundleSha256 does not bind its canonical root and exact member identities",
        )
    if expected_members is not None and members != list(expected_members):
        fail("ROOM_ENVELOPE_MEMBER_MISMATCH", "review member identities differ from the expected bundle")
    if expected_bundle == RECEPTION_POTREE_BUNDLE_SHA256:
        for row, (role, leaf) in zip(members, MEMBER_SPECS, strict=True):
            pin = registration.POTREE_FILE_PINS[leaf]
            if row["role"] != role or row["sizeBytes"] != pin["sizeBytes"] or row["sha256"] != pin["sha256"]:
                fail("ROOM_ENVELOPE_MEMBER_MISMATCH", "review member does not match an exact Reception pin")
    selected_preview = _preview(source["preview"], "source.preview")

    review = _object(
        top["review"],
        {"roomLabel", "reviewerLabel", "reviewedAt", "decision", "note", "reviewedPreviews"},
        "review",
    )
    _text(review["roomLabel"], "review.roomLabel", minimum=1, maximum=160, trimmed=True)
    _text(review["reviewerLabel"], "review.reviewerLabel", minimum=1, maximum=160, trimmed=True)
    reviewed_at = _text(review["reviewedAt"], "review.reviewedAt", minimum=20, maximum=64)
    if not _RFC3339_UTC.fullmatch(reviewed_at):
        fail("INVALID_ROOM_ENVELOPE_REVIEW", "review.reviewedAt must be an RFC3339 UTC timestamp")
    try:
        datetime.fromisoformat(reviewed_at[:-1] + "+00:00")
    except ValueError:
        fail("INVALID_ROOM_ENVELOPE_REVIEW", "review.reviewedAt is not a real timestamp")
    decision = _text(review["decision"], "review.decision", minimum=1, maximum=32)
    if decision not in ("accepted_as_fit_seed", "needs_revision"):
        fail("INVALID_ROOM_ENVELOPE_REVIEW", "review.decision is invalid")
    _text(review["note"], "review.note", maximum=1000, trimmed=True)
    preview_values = _array(review["reviewedPreviews"], "review.reviewedPreviews")
    if len(preview_values) != len(PREVIEW_SPECS):
        fail("INVALID_ROOM_ENVELOPE_PREVIEW", "all three canonical previews must be reviewed")
    reviewed_previews = [
        _preview(value, f"review.reviewedPreviews[{index}]")
        for index, value in enumerate(preview_values)
    ]
    if [row["viewId"] for row in reviewed_previews] != [row[0] for row in PREVIEW_SPECS]:
        fail("INVALID_ROOM_ENVELOPE_PREVIEW", "reviewed previews are not in canonical order")
    if expected_bundle == RECEPTION_POTREE_BUNDLE_SHA256:
        for preview in reviewed_previews:
            expected_pin = RECEPTION_PREVIEW_PINS[preview["viewId"]]
            if any(preview[key] != expected_pin[key] for key in expected_pin):
                fail("ROOM_ENVELOPE_PREVIEW_MISMATCH", "reviewed preview is not an exact Reception V8 pin")

    selection = _object(
        top["selection"],
        {
            "horizontalViewId",
            "projectedAxes",
            "omittedAxis",
            "polygonIntrinsicPixels",
            "polygonDecoderCoordinates",
            "mapping",
            "includedRecordCount",
            "excludedRecordCount",
            "includedDecodedBounds",
        },
        "selection",
    )
    horizontal_view = _text(
        selection["horizontalViewId"], "selection.horizontalViewId", minimum=1, maximum=32
    )
    axes_raw = _array(selection["projectedAxes"], "selection.projectedAxes")
    if len(axes_raw) != 2:
        fail("INVALID_ROOM_ENVELOPE_REVIEW", "selection.projectedAxes must have two axes")
    projected_axes = (
        _axis(axes_raw[0], "selection.projectedAxes[0]"),
        _axis(axes_raw[1], "selection.projectedAxes[1]"),
    )
    omitted_axis = _axis(selection["omittedAxis"], "selection.omittedAxis")
    matching_previews = [row for row in reviewed_previews if row["viewId"] == horizontal_view]
    if (
        len(matching_previews) != 1
        or matching_previews[0] != selected_preview
        or tuple(selected_preview["projectedAxes"]) != projected_axes
        or selected_preview["omittedAxis"] != omitted_axis
    ):
        fail("ROOM_ENVELOPE_PREVIEW_MISMATCH", "selected preview and selection axes are inconsistent")

    mapping = _object(
        selection["mapping"],
        {
            "profile",
            "decodedMin",
            "decodedMax",
            "width",
            "height",
            "marginPixels",
            "fitScale",
            "offsetX",
            "offsetY",
            "yAxisRule",
        },
        "selection.mapping",
    )
    if mapping["profile"] != ROOM_MAPPING_PROFILE or mapping["yAxisRule"] != ROOM_MAPPING_Y_AXIS_RULE:
        fail("INVALID_ROOM_ENVELOPE_MAPPING", "selection mapping profile or Y-axis rule is invalid")
    decoded_min = _vec(mapping["decodedMin"], 3, "selection.mapping.decodedMin")
    decoded_max = _vec(mapping["decodedMax"], 3, "selection.mapping.decodedMax")
    if any(low > high for low, high in zip(decoded_min, decoded_max, strict=True)):
        fail("INVALID_ROOM_ENVELOPE_MAPPING", "decodedMin exceeds decodedMax")
    width = _safe_int(mapping["width"], "selection.mapping.width")
    height = _safe_int(mapping["height"], "selection.mapping.height")
    margin_pixels = _safe_int(mapping["marginPixels"], "selection.mapping.marginPixels")
    if (width, height, margin_pixels) != (ROOM_PREVIEW_WIDTH, ROOM_PREVIEW_HEIGHT, ROOM_PREVIEW_MARGIN):
        fail("INVALID_ROOM_ENVELOPE_MAPPING", "mapping raster dimensions or margin are not frozen V8 values")
    fit_scale = _finite(mapping["fitScale"], "selection.mapping.fitScale", positive=True)
    offset_x = _finite(mapping["offsetX"], "selection.mapping.offsetX", nonnegative=True)
    offset_y = _finite(mapping["offsetY"], "selection.mapping.offsetY", nonnegative=True)
    span_x = decoded_max[projected_axes[0]] - decoded_min[projected_axes[0]]
    span_y = decoded_max[projected_axes[1]] - decoded_min[projected_axes[1]]
    available_width = width - 2 * margin_pixels
    available_height = height - 2 * margin_pixels
    expected_scale = min(
        1.0 if span_x == 0.0 else available_width / span_x,
        1.0 if span_y == 0.0 else available_height / span_y,
    )
    expected_offset_x = (width - span_x * expected_scale) / 2.0
    expected_offset_y = (height - span_y * expected_scale) / 2.0
    if not (
        _approximately_equal(fit_scale, expected_scale)
        and _approximately_equal(offset_x, expected_offset_x)
        and _approximately_equal(offset_y, expected_offset_y)
    ):
        fail("INVALID_ROOM_ENVELOPE_MAPPING", "mapping values do not match the frozen V8 observed-extrema fit")

    intrinsic_values = _array(
        selection["polygonIntrinsicPixels"],
        "selection.polygonIntrinsicPixels",
        minimum=3,
        maximum=ROOM_REVIEW_MAX_VERTICES,
    )
    intrinsic: list[list[int]] = []
    for index, value in enumerate(intrinsic_values):
        pair = _array(value, f"selection.polygonIntrinsicPixels[{index}]")
        if len(pair) != 2:
            fail("INVALID_ROOM_ENVELOPE_POLYGON", "intrinsic polygon vertices must be pairs")
        intrinsic.append(
            [
                _safe_int(pair[0], f"intrinsic[{index}][0]", maximum=width - 1),
                _safe_int(pair[1], f"intrinsic[{index}][1]", maximum=height - 1),
            ]
        )
    _validate_simple_polygon(intrinsic, "selection.polygonIntrinsicPixels")
    decoder_values = _array(
        selection["polygonDecoderCoordinates"],
        "selection.polygonDecoderCoordinates",
        minimum=3,
        maximum=ROOM_REVIEW_MAX_VERTICES,
    )
    if len(decoder_values) != len(intrinsic):
        fail("INVALID_ROOM_ENVELOPE_POLYGON", "intrinsic and decoder polygons differ in length")
    decoder = [_vec(value, 2, f"selection.polygonDecoderCoordinates[{index}]") for index, value in enumerate(decoder_values)]
    for index, pixel in enumerate(intrinsic):
        expected_pair = (
            _js_rounded_12(
                decoded_min[projected_axes[0]] + (pixel[0] - offset_x) / fit_scale
            ),
            _js_rounded_12(
                decoded_min[projected_axes[1]]
                + (height - 1 - pixel[1] - offset_y) / fit_scale
            ),
        )
        if not all(
            _approximately_equal(decoder[index][axis], expected_pair[axis]) for axis in (0, 1)
        ):
            fail("INVALID_ROOM_ENVELOPE_MAPPING", "decoder polygon does not invert the intrinsic polygon")

    included_count = _safe_int(selection["includedRecordCount"], "selection.includedRecordCount")
    excluded_count = _safe_int(selection["excludedRecordCount"], "selection.excludedRecordCount")
    if included_count + excluded_count < 1 or included_count + excluded_count > _SAFE_INTEGER_MAX:
        fail("INVALID_ROOM_ENVELOPE_REVIEW", "included and excluded counts are inconsistent")
    bounds_value = selection["includedDecodedBounds"]
    if (included_count == 0) != (bounds_value is None):
        fail("INVALID_ROOM_ENVELOPE_REVIEW", "included bounds must exist exactly when records are included")
    if bounds_value is not None:
        bounds = _object(bounds_value, {"min", "max"}, "selection.includedDecodedBounds")
        bounds_min = _vec(bounds["min"], 3, "selection.includedDecodedBounds.min")
        bounds_max = _vec(bounds["max"], 3, "selection.includedDecodedBounds.max")
        for axis in range(3):
            if (
                bounds_min[axis] > bounds_max[axis]
                or bounds_min[axis] < decoded_min[axis] - max(1.0, abs(decoded_min[axis])) * 1e-10
                or bounds_max[axis] > decoded_max[axis] + max(1.0, abs(decoded_max[axis])) * 1e-10
            ):
                fail("INVALID_ROOM_ENVELOPE_REVIEW", "included bounds exceed observed decoder bounds")

    eligibility = _text(top["eligibility"], "eligibility", minimum=1, maximum=64)
    if eligibility not in ("eligible_for_fit_only_diagnostic", "not_eligible"):
        fail("INVALID_ROOM_ENVELOPE_REVIEW", "eligibility value is invalid")
    expected_eligibility = (
        "eligible_for_fit_only_diagnostic"
        if decision == "accepted_as_fit_seed" and included_count >= ROOM_REVIEW_MIN_INCLUDED_RECORDS
        else "not_eligible"
    )
    if eligibility != expected_eligibility:
        fail("ROOM_ENVELOPE_ELIGIBILITY_MISMATCH", "eligibility contradicts decision or included count")

    policy = _object(
        top["policy"],
        {"fitOnlyDiagnostic", "validationInputsRead", "sourceBytesMutated", "networkUsed"},
        "policy",
    )
    if not (
        policy["fitOnlyDiagnostic"] is True
        and policy["validationInputsRead"] is False
        and policy["sourceBytesMutated"] is False
        and policy["networkUsed"] is False
    ):
        fail("INVALID_ROOM_ENVELOPE_POLICY", "review policy is not fit-only and read-only")
    limitations = _array(top["limitations"], "limitations")
    if tuple(limitations) != ROOM_REVIEW_LIMITATIONS:
        fail("INVALID_ROOM_ENVELOPE_REVIEW", "review limitations differ from the frozen V0 contract")

    unsigned = copy.deepcopy(top)
    unsigned.pop("reportSha256")
    computed = hashlib.sha256(
        ROOM_REVIEW_DIGEST_DOMAIN + alignment._canonical_json_bytes(unsigned)
    ).hexdigest()
    if computed != report_sha:
        fail("ROOM_ENVELOPE_DIGEST_MISMATCH", "reportSha256 does not bind the canonical review")
    if require_accepted and (
        decision != "accepted_as_fit_seed" or eligibility != "eligible_for_fit_only_diagnostic"
    ):
        fail("ROOM_ENVELOPE_REVIEW_NOT_ACCEPTED", "room envelope is not accepted and eligible for fit-only use")
    return top


def _load_room_envelope_review(
    path: Path,
    *,
    expected_bundle_sha256: str,
    expected_members: Sequence[dict[str, Any]] | None = None,
    require_accepted: bool = True,
) -> RoomReviewBundle:
    resolved, snapshot, payload, file_sha = alignment._read_bound_bytes(
        path, "room-envelope review", ROOM_REVIEW_MAX_BYTES
    )
    document = _parse_review_payload(payload, "room-envelope review")
    validated = _validate_review_document(
        document,
        expected_bundle_sha256=expected_bundle_sha256,
        expected_members=expected_members,
        require_accepted=require_accepted,
    )
    return RoomReviewBundle(resolved, snapshot, file_sha, validated)


def parse_room_envelope_review(
    path: Path,
    *,
    expected_bundle_sha256: str,
    expected_members: Sequence[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Strictly parse a review that is accepted and eligible for fitting."""

    return _load_room_envelope_review(
        Path(path),
        expected_bundle_sha256=expected_bundle_sha256,
        expected_members=expected_members,
        require_accepted=True,
    ).document


def _verify_review_against_potree(review: dict[str, Any], potree: registration.PotreeBundle) -> None:
    for row, (role, leaf) in zip(review["source"]["members"], MEMBER_SPECS, strict=True):
        snapshot = potree.snapshots[leaf]
        if (
            row["role"] != role
            or row["sizeBytes"] != snapshot.size_bytes
            or row["sha256"] != potree.hashes[leaf]
        ):
            fail("ROOM_ENVELOPE_MEMBER_MISMATCH", "review member identities differ from loaded Potree bytes")
    total = review["selection"]["includedRecordCount"] + review["selection"]["excludedRecordCount"]
    if total != potree.metadata["points"]:
        fail("ROOM_ENVELOPE_RECORD_COUNT_MISMATCH", "review counts differ from loaded Potree records")
    actual_bounds = potree.evidence["decoderValidation"]["actualPositionBoundsMeters"]
    mapping = review["selection"]["mapping"]
    for label, expected in (("decodedMin", actual_bounds["min"]), ("decodedMax", actual_bounds["max"])):
        if not all(
            _approximately_equal(float(left), float(right))
            for left, right in zip(mapping[label], expected, strict=True)
        ):
            fail("ROOM_ENVELOPE_DECODER_BOUNDS_MISMATCH", "review mapping bounds differ from loaded decoded points")


def _inside_polygon_with_margin(points: Any, polygon: Any, margin: float, np: Any) -> Any:
    """Vectorized boundary-inclusive polygon plus Euclidean edge margin."""

    x = points[:, 0]
    y = points[:, 1]
    inside = np.zeros(points.shape[0], dtype=bool)
    boundary = np.zeros(points.shape[0], dtype=bool)
    minimum_squared = np.full(points.shape[0], np.inf, dtype=np.float64)
    for index in range(polygon.shape[0]):
        a = polygon[index]
        b = polygon[(index + 1) % polygon.shape[0]]
        dx = float(b[0] - a[0])
        dy = float(b[1] - a[1])
        length_squared = dx * dx + dy * dy
        if length_squared <= 0.0:
            fail("INVALID_ROOM_ENVELOPE_POLYGON", "decoder polygon contains a zero-length edge")
        parameter = np.clip(((x - a[0]) * dx + (y - a[1]) * dy) / length_squared, 0.0, 1.0)
        closest_x = a[0] + parameter * dx
        closest_y = a[1] + parameter * dy
        distance_squared = (x - closest_x) ** 2 + (y - closest_y) ** 2
        minimum_squared = np.minimum(minimum_squared, distance_squared)
        boundary |= distance_squared <= 1e-24
        crosses = (a[1] > y) != (b[1] > y)
        x_intersection = dx * (y - a[1]) / dy + a[0] if dy != 0.0 else np.zeros_like(x)
        inside ^= crosses & (x < x_intersection)
    return inside | boundary | (minimum_squared <= margin * margin)


def _crop_mask(points: Any, review: dict[str, Any], margin: float, np: Any) -> Any:
    selection = review["selection"]
    axes = tuple(selection["projectedAxes"])
    omitted = int(selection["omittedAxis"])
    polygon = np.asarray(selection["polygonDecoderCoordinates"], dtype=np.float64)
    projected = points[:, np.asarray(axes, dtype=np.int64)]
    horizontal = _inside_polygon_with_margin(projected, polygon, margin, np)
    mapping = selection["mapping"]
    lower = float(mapping["decodedMin"][omitted]) - margin
    upper = float(mapping["decodedMax"][omitted]) + margin
    vertical = (points[:, omitted] >= lower) & (points[:, omitted] <= upper)
    return horizontal & vertical


def _bounds(points: Any, np: Any) -> dict[str, Any] | None:
    if int(points.shape[0]) == 0:
        return None
    return {
        "min": [float(value) for value in np.min(points, axis=0)],
        "max": [float(value) for value in np.max(points, axis=0)],
    }


def _crop_evidence(
    source: Any,
    target: Any,
    source_mask: Any,
    target_mask: Any,
    points_by_scan: dict[int, Any],
    margin: float,
    review: dict[str, Any],
    np: Any,
) -> dict[str, Any]:
    per_scan: list[dict[str, Any]] = []
    cursor = 0
    for scan_id in FIT_SCAN_IDS:
        count = int(points_by_scan[scan_id].shape[0])
        per_scan.append(
            {
                "scanId": scan_id,
                "inputSamplePointCount": count,
                "selectedSamplePointCount": int(np.count_nonzero(target_mask[cursor : cursor + count])),
            }
        )
        cursor += count
    return {
        "coordinateSpace": "potree_v2_decoder_coordinates_via_candidate_inverse_map",
        "cropMarginDecoderCoordinates": margin,
        "cropRule": "polygon interior or Euclidean edge distance <= margin, and omitted-axis observed range expanded by margin",
        "projectedAxes": list(review["selection"]["projectedAxes"]),
        "omittedAxis": review["selection"]["omittedAxis"],
        "sourceInputSamplePointCount": int(source.shape[0]),
        "sourceSelectedSamplePointCount": int(np.count_nonzero(source_mask)),
        "targetInputSamplePointCount": int(target.shape[0]),
        "targetSelectedSamplePointCount": int(np.count_nonzero(target_mask)),
        "sourceSelectedBoundsDecoderCoordinates": _bounds(source[source_mask], np),
        "inverseMappedTargetSelectedBoundsDecoderCoordinates": _bounds(target[target_mask], np),
        "fitScanSelection": per_scan,
        "minimumRequiredPerSide": alignment.MIN_DIAGNOSTIC_POINTS,
    }


def _candidate_initial(
    rotation: Any,
    translation: Any,
    trace: dict[str, Any],
    determinant_sign: int,
    np: Any,
) -> dict[str, Any]:
    return {
        "transform": registration._transform_evidence(
            rotation, translation, np, determinant_sign=determinant_sign
        ),
        "fitTrace": trace,
        "isApproval": False,
    }


def _source_evidence(path: Path, snapshot: alignment.FileSnapshot, sha256: str) -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": sha256,
        "fullyHashedThisRun": True,
        "snapshot": registration._snapshot_evidence(snapshot),
    }


def _seal_receipt(document: dict[str, Any]) -> dict[str, Any]:
    unsigned = copy.deepcopy(document)
    unsigned.pop("receipt", None)
    digest = hashlib.sha256(
        RECEIPT_DIGEST_DOMAIN + alignment._canonical_json_bytes(unsigned)
    ).hexdigest()
    sealed = copy.deepcopy(unsigned)
    sealed["receipt"] = {
        "algorithm": "SHA-256",
        "domain": RECEIPT_DIGEST_DOMAIN_LABEL,
        "sha256": digest,
        "authenticatesCreator": False,
        "provesTimestamp": False,
        "isSignature": False,
    }
    return sealed


def _scope(test_adapter_mode: bool) -> dict[str, Any]:
    scope: dict[str, Any] = {
        "roomLabel": "Reception Room",
        "fitScanIds": list(FIT_SCAN_IDS),
        "exactE57ScanIdsRequested": list(FIT_SCAN_IDS),
        "fitScanIdsRequestedByConsumer": True,
        "validationScanIds": list(VALIDATION_SCAN_IDS),
        "validationScanIdsNotRequestedByConsumer": True,
        "frozenTestScanIds": list(FROZEN_TEST_SCAN_IDS),
        "frozenTestScanIdsNotRequestedByConsumer": True,
        "quarantinedScanIds": list(QUARANTINED_SCAN_IDS),
        "quarantinedScanIdsNotRequestedByConsumer": True,
        "validationUsedDuringFit": False,
        "testOnlyCustomAdapterMode": test_adapter_mode,
    }
    if test_adapter_mode:
        scope["customAdapterReadOrUseOfUnrequestedScans"] = "unestablished"
    else:
        scope.update(
            {
                "fitScanIdsRequestedReadAndUsed": True,
                "validationScanIdsNotRequestedReadOrUsed": True,
                "frozenTestScanIdsNotRequestedReadOrUsed": True,
                "quarantinedScanIdsNotRequestedReadOrUsed": True,
            }
        )
    return scope


def _safety(test_adapter_mode: bool) -> dict[str, Any]:
    return {
        "sourceMutationPermitted": False,
        "sourceMutationPerformed": None if test_adapter_mode else False,
        "derivedPointCloudOrModelFileCreated": None if test_adapter_mode else False,
        "approvedTransformArtifactCreated": False,
        "transformRegisteredSignedOrPromotedByConsumer": False,
        "trainingPermitted": False,
        "trainingPerformed": None if test_adapter_mode else False,
        "networkOrProviderUsePermitted": False,
        "networkOrProviderUsePerformed": None if test_adapter_mode else False,
        "publicationOrPromotionPermitted": False,
        "publicationOrPromotionPerformed": None if test_adapter_mode else False,
        "customAdapterSideEffectsEstablished": not test_adapter_mode,
        "outputPolicy": (
            "test-only authority-none receipt; custom-adapter side effects unestablished; unusable as evidence"
            if test_adapter_mode
            else "one create-only authority-none candidate/refusal receipt; no geometry or approved transform artifact"
        ),
    }


def run_fit_only(
    arguments: argparse.Namespace,
    *,
    e57_adapter: Any | None = None,
    enforce_production_pins: bool = True,
    _test_only_allow_custom_e57_adapter: bool = False,
    expected_bundle_sha256: str = RECEPTION_POTREE_BUNDLE_SHA256,
) -> dict[str, Any]:
    registration._verify_helper_contract()
    if set(FIT_SCAN_IDS) & ALL_NON_FIT_SCAN_IDS:
        fail("INTERNAL_SCAN_FIREWALL_ERROR", "fit scans overlap a held-back split")
    test_adapter_mode = e57_adapter is not None
    if not test_adapter_mode and (
        not enforce_production_pins
        or expected_bundle_sha256 != RECEPTION_POTREE_BUNDLE_SHA256
    ):
        fail(
            "PRODUCTION_PIN_BYPASS_FORBIDDEN",
            "non-test execution requires exact Reception Potree and bundle pins",
        )
    if test_adapter_mode and (enforce_production_pins or not _test_only_allow_custom_e57_adapter):
        fail(
            "CUSTOM_E57_ADAPTER_FORBIDDEN",
            "custom E57 adapters require the internal test-only switch and disabled production pins",
        )
    if _test_only_allow_custom_e57_adapter and not test_adapter_mode:
        fail("INVALID_TEST_ADAPTER_MODE", "the internal test switch requires a custom E57 adapter")
    crop_margin = _finite(
        arguments.crop_margin_decoder,
        "crop margin in decoder coordinates",
        nonnegative=True,
    )
    np, _scipy, cKDTree, dependency_versions = alignment._load_geometry_dependencies()

    tool_path, tool_snapshot, tool_evidence = registration._source_binding(
        Path(__file__), "fit-envelope consumer source"
    )
    registration_path, registration_snapshot, registration_evidence = registration._source_binding(
        Path(registration.__file__), "Potree registration helper source"
    )
    alignment_path, alignment_snapshot, alignment_evidence = registration._source_binding(
        Path(alignment.__file__), "alignment helper source"
    )
    review_bundle = _load_room_envelope_review(
        Path(arguments.room_envelope_review),
        expected_bundle_sha256=expected_bundle_sha256,
        require_accepted=True,
    )
    potree = registration.load_potree_model(
        Path(arguments.potree_model),
        sample_limit=arguments.potree_sample_points,
        np=np,
        enforce_production_pins=enforce_production_pins,
    )
    _verify_review_against_potree(review_bundle.document, potree)

    e57_path, e57_snapshot = alignment._safe_regular_file(
        Path(arguments.e57), "Reception E57", alignment.MAX_E57_BYTES
    )
    if e57_snapshot.size_bytes != RECEPTION_E57_SIZE_BYTES:
        fail("E57_SIZE_MISMATCH", "Reception E57 size differs from the frozen identity")
    e57_full_sha256: str | None = None
    if arguments.verify_e57_bytes:
        e57_full_sha256 = alignment._hash_file(e57_path, e57_snapshot, "Reception E57")
        if e57_full_sha256 != RECEPTION_E57_SHA256:
            fail("E57_SHA256_MISMATCH", "fully read Reception E57 differs from the frozen identity")

    selected_adapter = e57_adapter if e57_adapter is not None else alignment.Pye57PointAdapter()
    strict_adapter = _ExactFitScanScopeAdapter(selected_adapter)
    points_by_scan, e57_read = alignment._read_e57_point_samples(
        e57_path,
        e57_snapshot,
        FIT_SCAN_IDS,
        arguments.points_per_scan,
        np,
        strict_adapter,
    )
    if set(points_by_scan) != set(FIT_SCAN_IDS):
        fail("E57_SCAN_FIREWALL_BREACH", "E57 reader returned scans outside the exact fit request")
    if test_adapter_mode:
        e57_read = copy.deepcopy(e57_read)
        e57_read["openMode"] = "unestablished_custom_test_adapter"
        e57_read["customAdapterSideEffectsEstablished"] = False
    source = potree.sampled_points
    fit_target = np.vstack([points_by_scan[scan_id] for scan_id in FIT_SCAN_IDS])

    initial: dict[int, tuple[Any, Any, dict[str, Any]]] = {}
    for determinant_sign in (1, -1):
        initial[determinant_sign] = alignment._fit_rigid_icp(
            source,
            fit_target,
            maximum_iterations=arguments.maximum_iterations,
            trim_fraction=arguments.trim_fraction,
            determinant_sign=determinant_sign,
            np=np,
            cKDTree=cKDTree,
        )
    source_mask = _crop_mask(source, review_bundle.document, crop_margin, np)
    candidate_rows: dict[int, dict[str, Any]] = {}
    insufficient: list[dict[str, Any]] = []
    for determinant_sign in (1, -1):
        rotation, translation, trace = initial[determinant_sign]
        inverse_mapped_target = (fit_target - translation) @ rotation
        target_mask = _crop_mask(
            inverse_mapped_target, review_bundle.document, crop_margin, np
        )
        crop = _crop_evidence(
            source,
            inverse_mapped_target,
            source_mask,
            target_mask,
            points_by_scan,
            crop_margin,
            review_bundle.document,
            np,
        )
        row = {
            "initialFit": _candidate_initial(
                rotation, translation, trace, determinant_sign, np
            ),
            "crop": crop,
        }
        candidate_rows[determinant_sign] = row
        if (
            crop["sourceSelectedSamplePointCount"] < alignment.MIN_DIAGNOSTIC_POINTS
            or crop["targetSelectedSamplePointCount"] < alignment.MIN_DIAGNOSTIC_POINTS
        ):
            insufficient.append(
                {
                    "handedness": "proper" if determinant_sign == 1 else "improper_mirror_competitor",
                    "sourceSelectedSamplePointCount": crop["sourceSelectedSamplePointCount"],
                    "targetSelectedSamplePointCount": crop["targetSelectedSamplePointCount"],
                }
            )

    outcome = "refusal" if insufficient else "candidate"
    if not insufficient:
        selected_source = source[source_mask]
        for determinant_sign in (1, -1):
            initial_rotation, initial_translation, _initial_trace = initial[determinant_sign]
            inverse_mapped_target = (fit_target - initial_translation) @ initial_rotation
            target_mask = _crop_mask(
                inverse_mapped_target, review_bundle.document, crop_margin, np
            )
            selected_target = fit_target[target_mask]
            rotation, translation, trace = alignment._fit_rigid_icp(
                selected_source,
                selected_target,
                maximum_iterations=arguments.maximum_iterations,
                trim_fraction=arguments.trim_fraction,
                determinant_sign=determinant_sign,
                np=np,
                cKDTree=cKDTree,
            )
            candidate_rows[determinant_sign]["refit"] = {
                "transform": registration._transform_evidence(
                    rotation, translation, np, determinant_sign=determinant_sign
                ),
                "fitTrace": trace,
                "fitMetrics": alignment._evaluate_bidirectional(
                    selected_source,
                    selected_target,
                    rotation,
                    translation,
                    arguments.overlap_distance_m,
                    np,
                    cKDTree,
                ),
                "isApprovedTransform": False,
            }

    alignment._snapshot_matches(e57_path, e57_snapshot, "Reception E57")
    registration._verify_small_sources_unchanged(
        potree,
        (
            (tool_path, tool_snapshot, "fit-envelope consumer source", tool_evidence["sha256"]),
            (
                registration_path,
                registration_snapshot,
                "Potree registration helper source",
                registration_evidence["sha256"],
            ),
            (
                alignment_path,
                alignment_snapshot,
                "alignment helper source",
                alignment_evidence["sha256"],
            ),
            (
                review_bundle.path,
                review_bundle.snapshot,
                "room-envelope review",
                review_bundle.file_sha256,
            ),
        ),
    )
    if e57_full_sha256 is not None:
        current_e57_sha = alignment._hash_file(e57_path, e57_snapshot, "Reception E57")
        if current_e57_sha != e57_full_sha256:
            fail("FILE_CHANGED_DURING_RUN", "Reception E57 changed during the diagnostic")

    fit_only: dict[str, Any] = {
        "outcome": outcome,
        "roomEnvelopeReviewSha256": review_bundle.document["reportSha256"],
        "cropMarginDecoderCoordinates": crop_margin,
        "properCandidate": {
            "isCandidateOnly": True,
            "isPermittedHandednessFamily": True,
            **candidate_rows[1],
        },
        "improperMirrorCompetitor": {
            "isPermittedTransformCandidate": False,
            "purpose": "negative control for geometric handedness ambiguity",
            **candidate_rows[-1],
        },
        "units": (
            "The review does not establish units. Helper fields whose names end in Meters "
            "retain the pre-existing equal-unit/metre assumption; the crop margin is explicitly "
            "in Potree decoder-coordinate units; scale is fixed to exactly 1 and not fitted."
        ),
    }
    if insufficient:
        fit_only["reason"] = {
            "code": "INSUFFICIENT_ENVELOPE_CROP",
            "message": "At least one handedness family retained too few cropped source or fit samples to refit safely.",
            "minimumRequiredPerSide": alignment.MIN_DIAGNOSTIC_POINTS,
            "insufficientCandidates": insufficient,
        }

    status_outcome = "candidate" if outcome == "candidate" else "refused"
    status = (
        f"fit_only_envelope_{status_outcome}_test_adapter_unusable_authority_none"
        if test_adapter_mode
        else f"fit_only_envelope_{status_outcome}_authority_none"
    )
    result_type = (
        "test_adapter_result_unusable_as_evidence"
        if test_adapter_mode
        else (
            "read_only_fit_only_candidate_not_transform_artifact"
            if outcome == "candidate"
            else "fit_only_refusal_not_transform_artifact"
        )
    )
    limitations = [
        "The reviewed room envelope is a fit seed, not validation, an independent control, or transform authority.",
        "Only frozen fit stations were requested; validation, frozen-test, and quarantined stations were not requested by this consumer.",
        "The Potree source is a vendor-produced decimated preview and does not establish units, axes, CRS, or physical accuracy.",
        "Metric and transform field names inherited from the alignment helper do not turn the unverified equal-unit/metre assumption into established units.",
        "Nearest-neighbour agreement can be fooled by repeated surfaces, incomplete coverage, and mirrors.",
        "No proper-versus-mirror result approves physical handedness or a runtime transform.",
        "Without --verify-e57-bytes, the current E57 is bound by size and file identity checks rather than a current full-content hash.",
        "The self-digest detects unrecomputed edits but does not authenticate creator, time, rights, or truth.",
    ]
    if test_adapter_mode:
        limitations.append(
            "A custom test adapter ran arbitrary Python; its reads and side effects are unestablished, so this receipt is unusable as evidence."
        )
    document = {
        "schemaVersion": SCHEMA_VERSION,
        "status": status,
        "authority": "none",
        "resultType": result_type,
        "scope": _scope(test_adapter_mode),
        "inputEvidence": {
            "roomEnvelopeReview": {
                **_source_evidence(
                    review_bundle.path, review_bundle.snapshot, review_bundle.file_sha256
                ),
                "reportSha256": review_bundle.document["reportSha256"],
                "decision": review_bundle.document["review"]["decision"],
                "eligibility": review_bundle.document["eligibility"],
                "bundleSha256": review_bundle.document["source"]["bundleSha256"],
            },
            "potreePreview": potree.evidence,
            "e57": {
                "path": str(e57_path),
                "snapshot": registration._snapshot_evidence(e57_snapshot),
                "openMode": "unestablished_custom_test_adapter" if test_adapter_mode else "read-only",
                "adapterExecutionMode": "internal_test_only_untrusted" if test_adapter_mode else "pinned_production_adapter",
                "currentBytesFullyHashedThisRun": e57_full_sha256 is not None,
                "currentFullSha256": e57_full_sha256,
                "frozenExpectedSha256": RECEPTION_E57_SHA256,
                "frozenExpectedSha256ComparedToCurrentBytes": e57_full_sha256 is not None,
                "readEvidence": e57_read,
            },
            "code": {
                "fitEnvelopeConsumer": tool_evidence,
                "potreeRegistrationHelper": registration_evidence,
                "alignmentHelper": alignment_evidence,
            },
        },
        "fitOnlyDiagnostic": fit_only,
        "safety": _safety(test_adapter_mode),
        "eligibility": {
            "eligibleForTraining": False,
            "eligibleForRuntimeUse": False,
            "eligibleForPublicUse": False,
            "eligibleForTransformRegistration": False,
            "eligibleForEvidenceUse": False if test_adapter_mode else None,
            "requiresIndependentControlsAndHumanReview": True,
        },
        "limitations": limitations,
        "runtime": {
            "dependencies": dependency_versions,
            "python": platform.python_version(),
            "platform": platform.platform(),
        },
    }
    sealed = _seal_receipt(document)
    protected_paths = tuple(potree.paths.values()) + (
        e57_path,
        review_bundle.path,
        tool_path,
        registration_path,
        alignment_path,
    )
    protected_roots = (
        potree.root,
        e57_path.parent,
        review_bundle.path.parent,
        tool_path.parent,
    )
    registration._publish_receipt(
        Path(arguments.output), sealed, protected_paths, protected_roots
    )
    return sealed


def _positive_int(maximum: int) -> Any:
    def parse(raw: str) -> int:
        try:
            value = int(raw, 10)
        except ValueError as error:
            raise argparse.ArgumentTypeError("must be an integer") from error
        if value <= 0 or value > maximum:
            raise argparse.ArgumentTypeError(f"must be between 1 and {maximum}")
        return value

    return parse


def _fraction(raw: str) -> float:
    try:
        value = float(raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a number") from error
    if not math.isfinite(value) or not 0.0 < value <= 1.0:
        raise argparse.ArgumentTypeError("must be finite, greater than 0, and at most 1")
    return value


def _positive_float(raw: str) -> float:
    try:
        value = float(raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a number") from error
    if not math.isfinite(value) or value <= 0.0:
        raise argparse.ArgumentTypeError("must be finite and greater than zero")
    return value


def _nonnegative_float(raw: str) -> float:
    try:
        value = float(raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError("must be a number") from error
    if not math.isfinite(value) or value < 0.0:
        raise argparse.ArgumentTypeError("must be finite and nonnegative")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--potree-model", required=True, type=Path)
    parser.add_argument("--e57", required=True, type=Path)
    parser.add_argument("--room-envelope-review", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--crop-margin-decoder", required=True, type=_nonnegative_float)
    parser.add_argument(
        "--potree-sample-points",
        type=_positive_int(registration.POTREE_POINTS),
        default=registration.POTREE_POINTS,
    )
    parser.add_argument("--points-per-scan", type=_positive_int(100_000), default=2_000)
    parser.add_argument("--maximum-iterations", type=_positive_int(100), default=30)
    parser.add_argument("--trim-fraction", type=_fraction, default=0.80)
    parser.add_argument("--overlap-distance-m", type=_positive_float, default=0.20)
    parser.add_argument(
        "--verify-e57-bytes",
        action="store_true",
        help="read and SHA-256 all 20.5 GB before and after sampling; off by default",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = build_parser().parse_args(argv)
        receipt = run_fit_only(arguments)
        print(
            json.dumps(
                {
                    "status": receipt["status"],
                    "output": str(arguments.output),
                    "receiptSha256": receipt["receipt"]["sha256"],
                    "authority": "none",
                },
                sort_keys=True,
            )
        )
        return 0
    except alignment.AlignmentError as error:
        print(
            json.dumps(
                {
                    "status": "error_no_receipt_created",
                    "code": error.code,
                    "message": error.message,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
