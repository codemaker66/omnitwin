from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import html
import json
import math
import os
from pathlib import Path
import platform
import struct
import sys
from typing import Any, Callable, Iterable, Mapping, Sequence

import numpy as np

SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

import grand_hall_authority_none_icp_replay as replay


SCHEMA_VERSION = "venviewer.grand-hall.authority-none-icp-visual-review-pack.v1"
ARTIFACT_ID = "grand-hall-authority-none-icp-visual-review-2026-08-30-v1"
SOURCE_SHA256 = "ba5aa3d2c244acca3937505a17b34fb7f437ef5f59b7a85e7e691a2b2bcd47b6"
SOURCE_BYTE_LENGTH = 2_222_742
TARGET_SHA256 = "cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7"
TARGET_BYTE_LENGTH = 38_381_816
SEED_SCHEMA_VERSION = "venviewer.grand-hall-arf-cvf-registration-seed.v1"
SEED_CANONICAL_JSON_SHA256 = "ddd20078d3a61415d506b002f89fde146d28742d79a2f66ec0192923ef7f5a72"
SEED_FILE_SHA256 = "6ccf07ffe04a866be68454842b8390d626c84d7ca6da073a0ff367620e8342ed"
SEED_BYTE_LENGTH = 32_408
SEED_SEMANTIC_SHA256 = "sha256:786fe2d4f2e24209d440aefc6d2496337e13b37d9bcba77eafe39a2cf0856c78"
POSTFIT_PAIR_SHA256 = "9ee8d05eab0925f04734700ccd1eeebb7612bc2f81a3a9fd039e6f3f9b0bcc5e"
POSTFIT_DISTANCE_SHA256 = "373711d105def9ab5992788e8ab4bbe05697ceeddce117ba3781477f55a413bd"
ALL_SOURCE_DISTANCE_SHA256 = "db86df37dcdab47a1f8e6f146cab61e6a02b5f87dc1b4a0345dbd82972ebb7d4"
FINAL_TRANSFORMED_SOURCE_SHA256 = "c2cd63576b9227ed27a136ff87a4823e6401b5318de27f046a0c05567e0c7d2a"
REPLAY_IMPLEMENTATION_SHA256 = "7f2cce27db8e9b5edc9892ac19a705813665fbbe69235f2523b826baf8b530c6"
MUTUAL_THRESHOLD_METRES = 0.12
MAX_SOURCE_DISPLAY_POINTS = 14_000
MAX_TARGET_DISPLAY_POINTS = 16_000


class ReviewPackError(RuntimeError):
    pass


@dataclass(frozen=True)
class ViewSpec:
    file_name: str
    view_id: str
    title: str
    horizontal_axis: int
    vertical_axis: int
    horizontal_label: str
    vertical_label: str


@dataclass(frozen=True)
class ReviewEvidence:
    seed: Mapping[str, Any]
    seed_byte_length: int
    seed_file_sha256: str
    source_inventory: Mapping[str, Any]
    target_inventory: Mapping[str, Any]
    selected_source_indices: np.ndarray
    transformed_source: np.ndarray
    target: np.ndarray
    mutual_source_indices: np.ndarray
    mutual_target_indices: np.ndarray
    mutual_distances: np.ndarray
    all_source_distances: np.ndarray
    candidate_matrix: np.ndarray


VIEWS = (
    ViewSpec(
        "01-top-xy-overlay-residuals.svg",
        "top_xy_z_up",
        "Top view · XY plane · Z up",
        0,
        1,
        "X (CVF metres)",
        "Y (CVF metres)",
    ),
    ViewSpec(
        "02-front-xz-overlay-residuals.svg",
        "front_xz",
        "Front view · XZ plane",
        0,
        2,
        "X (CVF metres)",
        "Z (CVF metres)",
    ),
    ViewSpec(
        "03-side-yz-overlay-residuals.svg",
        "side_yz",
        "Side view · YZ plane",
        1,
        2,
        "Y (CVF metres)",
        "Z (CVF metres)",
    ),
)

RESIDUAL_BANDS = (
    (0.0, 0.02, "#22c55e", "0–20 mm"),
    (0.02, 0.05, "#a3e635", "20–50 mm"),
    (0.05, 0.08, "#f59e0b", "50–80 mm"),
    (0.08, MUTUAL_THRESHOLD_METRES, "#ef4444", "80–120 mm"),
)


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical_json_bytes(value: Any) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ReviewPackError("review-pack value is not canonical-JSON-safe") from error


def _strict_json_object(payload: bytes, label: str) -> Mapping[str, Any]:
    def reject_duplicates(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ReviewPackError(f"{label} contains a duplicate JSON key")
            result[key] = value
        return result

    try:
        decoded = payload.decode("utf-8", errors="strict")
        parsed = json.loads(decoded, object_pairs_hook=reject_duplicates)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ReviewPackError(f"{label} is not strict UTF-8 JSON") from error
    if not isinstance(parsed, dict):
        raise ReviewPackError(f"{label} root must be an object")
    return parsed


def _read_canonical_json(path: Path, label: str) -> tuple[Mapping[str, Any], bytes]:
    payload, _ = replay._stable_regular_file_snapshot(path, label=label)
    parsed = _strict_json_object(payload, label)
    canonical = _canonical_json_bytes(parsed)
    if payload not in (canonical, canonical + b"\n"):
        raise ReviewPackError(f"{label} is not in the exact canonical JSON representation")
    return parsed, payload


def _float64_from_bits(value: Any, label: str) -> float:
    if not isinstance(value, str) or len(value) != 16:
        raise ReviewPackError(f"{label} must be a 16-character float64 bit pattern")
    try:
        result = struct.unpack(">d", bytes.fromhex(value))[0]
    except (ValueError, struct.error) as error:
        raise ReviewPackError(f"{label} is not a float64 bit pattern") from error
    if not math.isfinite(result):
        raise ReviewPackError(f"{label} decodes to a non-finite value")
    return result


def _float64_bits(value: float) -> str:
    if not math.isfinite(value):
        raise ReviewPackError("cannot encode a non-finite float64 value")
    return struct.pack(">d", float(value)).hex()


def _nested(root: Mapping[str, Any], path: Sequence[str]) -> Any:
    value: Any = root
    for key in path:
        if not isinstance(value, dict) or key not in value:
            raise ReviewPackError(f"required seed field is absent: {'.'.join(path)}")
        value = value[key]
    return value


def _require_seed_guardrails(seed: Mapping[str, Any]) -> None:
    required = {
        "acceptedTransform": None,
        "architecturalEvidence": False,
        "authority": "none",
        "coordinatePairs": None,
        "outputMask": None,
        "permitsCoordinateAcceptance": False,
        "permitsOutputMasking": False,
        "permitsPublication": False,
        "permitsRuntimeUse": False,
        "permitsTransformAcceptance": False,
        "productionTrust": None,
        "roomMembershipAuthority": "none",
        "sourceSelectionIsGrandHallMask": False,
    }
    guardrails = seed.get("guardrails")
    if not isinstance(guardrails, dict):
        raise ReviewPackError("registration seed guardrails are absent")
    for key, expected in required.items():
        if guardrails.get(key) != expected:
            raise ReviewPackError(f"registration seed guardrail drifted: {key}")


def _load_seed(path: Path) -> tuple[Mapping[str, Any], int, str]:
    seed, payload = _read_canonical_json(path, "registration seed")
    file_sha256 = _sha256_bytes(payload)
    if len(payload) != SEED_BYTE_LENGTH or file_sha256 != SEED_FILE_SHA256:
        raise ReviewPackError("registration seed file bytes differ from the exact binding")
    canonical_sha256 = _sha256_bytes(_canonical_json_bytes(seed))
    if canonical_sha256 != SEED_CANONICAL_JSON_SHA256:
        raise ReviewPackError("registration seed differs from the exact reviewed binding")
    if seed.get("schemaVersion") != SEED_SCHEMA_VERSION:
        raise ReviewPackError("registration seed schema version differs")
    if seed.get("artifactSha256") != SEED_SEMANTIC_SHA256:
        raise ReviewPackError("registration seed semantic self-digest differs")
    _require_seed_guardrails(seed)
    return seed, len(payload), file_sha256


def _candidate_matrix(seed: Mapping[str, Any]) -> np.ndarray:
    encoded = _nested(seed, ("finalResult", "candidateArfToCvfRowMajorMatrixFloat64Hex"))
    if not isinstance(encoded, list) or len(encoded) != 16:
        raise ReviewPackError("registration seed candidate matrix must contain 16 values")
    values = [
        _float64_from_bits(value, f"candidate matrix element {index}")
        for index, value in enumerate(encoded)
    ]
    matrix = np.asarray(values, dtype=np.float64).reshape((4, 4))
    if not np.array_equal(matrix[3], np.asarray([0.0, 0.0, 0.0, 1.0])):
        raise ReviewPackError("candidate matrix has a non-affine final row")
    return matrix


def _assert_input_binding(
    inventory: Mapping[str, Any], *, expected_sha256: str, expected_bytes: int, label: str
) -> None:
    if inventory.get("fileSha256") != expected_sha256:
        raise ReviewPackError(f"{label} SHA-256 differs from the exact reviewed binding")
    if inventory.get("fileSizeBytes") != expected_bytes:
        raise ReviewPackError(f"{label} byte length differs from the exact reviewed binding")


def _selected_source(
    source_all: np.ndarray, target: np.ndarray, seed: Mapping[str, Any]
) -> tuple[np.ndarray, np.ndarray]:
    target_minimum = np.min(target, axis=0)
    target_maximum = np.max(target, axis=0)
    initially_placed = replay._transform_points(
        source_all, replay.INITIAL_ROTATION, replay.INITIAL_TRANSLATION
    )
    mask = np.all(
        (initially_placed >= target_minimum - replay.ENVELOPE_PADDING_METRES)
        & (initially_placed <= target_maximum + replay.ENVELOPE_PADDING_METRES),
        axis=1,
    )
    indices = np.ascontiguousarray(np.flatnonzero(mask), dtype=np.int64)
    source = np.ascontiguousarray(source_all[indices], dtype=np.float64)
    expected_count = _nested(seed, ("source", "selection", "expectedSelectedVertexCount"))
    if indices.shape[0] != expected_count:
        raise ReviewPackError("selected source vertex count differs from the seed")
    expected_indices_sha = _nested(
        seed,
        ("source", "selection", "selectedOrderedSourceIndicesPackedLittleEndianInt64RawSha256"),
    )
    actual_indices_sha = replay._raw_array_sha256(indices, "<i8", name="selected source indices")
    if expected_indices_sha != f"sha256:{actual_indices_sha}":
        raise ReviewPackError("selected source ordinal inventory differs from the seed")
    return indices, source


def _transform_and_audit(
    source: np.ndarray, target: np.ndarray, matrix: np.ndarray, seed: Mapping[str, Any]
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    transformed = replay._transform_points(source, matrix[:3, :3], matrix[:3, 3])
    transformed_sha = replay._raw_array_sha256(
        transformed, "<f8", name="candidate transformed selected source"
    )
    if transformed_sha != FINAL_TRANSFORMED_SOURCE_SHA256:
        raise ReviewPackError("candidate-transformed selected source differs from the seed")
    source_indices, target_indices, distances, audit, all_distances = (
        replay._mutual_correspondences(
            transformed,
            target,
            replay.cKDTree(target),
            MUTUAL_THRESHOLD_METRES,
            context="visual-review-postfit-audit",
        )
    )
    expected_count = _nested(seed, ("finalResult", "postfitAudit", "correspondenceCount"))
    if source_indices.shape[0] != expected_count:
        raise ReviewPackError("postfit mutual correspondence count differs from the seed")
    if audit["orderedSourceTargetPairsPackedLittleEndianInt64RawSha256"] != POSTFIT_PAIR_SHA256:
        raise ReviewPackError("postfit mutual correspondence inventory differs from the seed")
    if replay._raw_array_sha256(distances, "<f8", name="mutual distances") != POSTFIT_DISTANCE_SHA256:
        raise ReviewPackError("postfit mutual residual inventory differs from the seed")
    if replay._raw_array_sha256(all_distances, "<f8", name="all distances") != ALL_SOURCE_DISTANCE_SHA256:
        raise ReviewPackError("all-source residual inventory differs from the seed")
    return transformed, source_indices, target_indices, distances, all_distances


def load_review_evidence(
    source_path: Path, target_path: Path, seed_path: Path
) -> ReviewEvidence:
    seed, seed_bytes, seed_file_sha = _load_seed(seed_path)
    source_all, source_inventory = replay._load_big_obj_vertices(source_path)
    target, target_inventory = replay._load_matterpak_group_vertices(
        target_path, replay.TARGET_GROUP_SUFFIX
    )
    _assert_input_binding(
        source_inventory,
        expected_sha256=SOURCE_SHA256,
        expected_bytes=SOURCE_BYTE_LENGTH,
        label="BIG OBJ",
    )
    _assert_input_binding(
        target_inventory,
        expected_sha256=TARGET_SHA256,
        expected_bytes=TARGET_BYTE_LENGTH,
        label="MatterPak OBJ",
    )
    selected_indices, source = _selected_source(source_all, target, seed)
    matrix = _candidate_matrix(seed)
    transformed, source_i, target_i, distances, all_distances = _transform_and_audit(
        source, target, matrix, seed
    )
    return ReviewEvidence(
        seed=seed,
        seed_byte_length=seed_bytes,
        seed_file_sha256=seed_file_sha,
        source_inventory=source_inventory,
        target_inventory=target_inventory,
        selected_source_indices=selected_indices,
        transformed_source=transformed,
        target=target,
        mutual_source_indices=source_i,
        mutual_target_indices=target_i,
        mutual_distances=distances,
        all_source_distances=all_distances,
        candidate_matrix=matrix,
    )


def _ordinal_sample(count: int, maximum: int) -> tuple[np.ndarray, int]:
    if count <= 0 or maximum <= 0:
        raise ReviewPackError("ordinal sample populations must be positive")
    stride = max(1, (count + maximum - 1) // maximum)
    return np.arange(0, count, stride, dtype=np.int64), stride


def _view_bounds(
    evidence: ReviewEvidence, view: ViewSpec
) -> tuple[float, float, float, float]:
    source_u = evidence.transformed_source[:, view.horizontal_axis]
    source_v = evidence.transformed_source[:, view.vertical_axis]
    target_u = evidence.target[:, view.horizontal_axis]
    target_v = evidence.target[:, view.vertical_axis]
    u_min = float(min(np.min(source_u), np.min(target_u)))
    u_max = float(max(np.max(source_u), np.max(target_u)))
    v_min = float(min(np.min(source_v), np.min(target_v)))
    v_max = float(max(np.max(source_v), np.max(target_v)))
    pad = max(u_max - u_min, v_max - v_min) * 0.04
    if not math.isfinite(pad) or pad <= 0.0:
        raise ReviewPackError("view bounds are degenerate")
    return u_min - pad, u_max + pad, v_min - pad, v_max + pad


def _projector(
    bounds: tuple[float, float, float, float],
) -> tuple[Callable[[float, float], tuple[float, float]], float]:
    left, right, bottom, top = bounds
    plot_x, plot_y, plot_width, plot_height = 70.0, 185.0, 1660.0, 820.0
    scale = min(plot_width / (right - left), plot_height / (top - bottom))
    used_width = (right - left) * scale
    used_height = (top - bottom) * scale
    x_offset = plot_x + (plot_width - used_width) / 2.0
    y_offset = plot_y + (plot_height - used_height) / 2.0

    def project(u: float, v: float) -> tuple[float, float]:
        return x_offset + (u - left) * scale, y_offset + (top - v) * scale

    return project, scale


def _residual_band(distance: float) -> tuple[str, str]:
    for lower, upper, color, label in RESIDUAL_BANDS:
        if lower <= distance < upper:
            return color, label
    raise ReviewPackError("a mutual residual is outside the declared display bands")


def _grid_elements(
    bounds: tuple[float, float, float, float],
    project: Callable[[float, float], tuple[float, float]],
) -> Iterable[str]:
    left, right, bottom, top = bounds
    for value in range(math.ceil(left), math.floor(right) + 1):
        x0, y0 = project(float(value), bottom)
        x1, y1 = project(float(value), top)
        yield f'<line x1="{x0:.3f}" y1="{y0:.3f}" x2="{x1:.3f}" y2="{y1:.3f}" stroke="#1e293b" stroke-width="0.7"/>'
        yield f'<text x="{x0:.3f}" y="1026" fill="#64748b" font-family="monospace" font-size="11" text-anchor="middle">{value}</text>'
    for value in range(math.ceil(bottom), math.floor(top) + 1):
        x0, y0 = project(left, float(value))
        x1, y1 = project(right, float(value))
        yield f'<line x1="{x0:.3f}" y1="{y0:.3f}" x2="{x1:.3f}" y2="{y1:.3f}" stroke="#1e293b" stroke-width="0.7"/>'
        yield f'<text x="55" y="{y0 + 4:.3f}" fill="#64748b" font-family="monospace" font-size="11" text-anchor="end">{value}</text>'


def _point_elements(
    points: np.ndarray,
    indices: np.ndarray,
    view: ViewSpec,
    project: Callable[[float, float], tuple[float, float]],
    *,
    color: str,
    opacity: float,
) -> Iterable[str]:
    for ordinal in indices:
        point = points[int(ordinal)]
        x, y = project(float(point[view.horizontal_axis]), float(point[view.vertical_axis]))
        yield f'<circle cx="{x:.3f}" cy="{y:.3f}" r="1.05" fill="{color}" fill-opacity="{opacity:.2f}" data-ordinal="{int(ordinal)}"/>'


def _residual_elements(
    evidence: ReviewEvidence,
    view: ViewSpec,
    project: Callable[[float, float], tuple[float, float]],
) -> Iterable[str]:
    for ordinal, (source_index, target_index, distance) in enumerate(
        zip(
            evidence.mutual_source_indices,
            evidence.mutual_target_indices,
            evidence.mutual_distances,
            strict=True,
        )
    ):
        source = evidence.transformed_source[int(source_index)]
        target = evidence.target[int(target_index)]
        x0, y0 = project(float(source[view.horizontal_axis]), float(source[view.vertical_axis]))
        x1, y1 = project(float(target[view.horizontal_axis]), float(target[view.vertical_axis]))
        color, label = _residual_band(float(distance))
        title = f"mutual pair {ordinal}; residual {float(distance) * 1000.0:.3f} mm; band {label}"
        yield (
            f'<line x1="{x0:.3f}" y1="{y0:.3f}" x2="{x1:.3f}" y2="{y1:.3f}" '
            f'stroke="{color}" stroke-width="0.9" stroke-opacity="0.72" '
            f'data-pair-ordinal="{ordinal}" data-selected-source-ordinal="{int(source_index)}" '
            f'data-room9-candidate-target-ordinal="{int(target_index)}"><title>{title}</title></line>'
        )


def _metric_from_seed(evidence: ReviewEvidence, field: str) -> float:
    value = _nested(evidence.seed, ("finalResult", "postfitAudit", "metrics", field))
    return _float64_from_bits(value, field)


def _view_header(evidence: ReviewEvidence, view: ViewSpec) -> list[str]:
    mean_mm = _metric_from_seed(evidence, "meanDistanceMetresFloat64Hex") * 1000.0
    p95_mm = _metric_from_seed(evidence, "p95DistanceMetresFloat64Hex") * 1000.0
    rmse_mm = _metric_from_seed(
        evidence, "rootMeanSquareDistanceMetresFloat64Hex"
    ) * 1000.0
    return [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1120" viewBox="0 0 1800 1120">',
        '<rect width="1800" height="1120" fill="#020617"/>',
        '<text x="55" y="48" fill="#f8fafc" font-family="monospace" font-size="24">Grand Hall authority-none ICP candidate review</text>',
        f'<text x="55" y="82" fill="#f59e0b" font-family="monospace" font-size="17">{html.escape(view.title)} · CANDIDATE ONLY · NOT AN ACCEPTED TRANSFORM</text>',
        '<text x="55" y="112" fill="#fb7185" font-family="monospace" font-size="14">Room 9 and the source selection are human-pending. This image grants no room, metric, mask, runtime, or architectural authority.</text>',
        f'<text x="55" y="142" fill="#cbd5e1" font-family="monospace" font-size="13">Mutual residuals: {evidence.mutual_distances.shape[0]:,} / {evidence.transformed_source.shape[0]:,} selected source vertices · mean {mean_mm:.3f} mm · p95 {p95_mm:.3f} mm · RMSE {rmse_mm:.3f} mm</text>',
        '<rect x="55" y="170" width="1690" height="850" fill="#0f172a" stroke="#334155" stroke-width="1"/>',
    ]


def _render_view(evidence: ReviewEvidence, view: ViewSpec) -> bytes:
    bounds = _view_bounds(evidence, view)
    project, _ = _projector(bounds)
    source_sample, source_stride = _ordinal_sample(
        evidence.transformed_source.shape[0], MAX_SOURCE_DISPLAY_POINTS
    )
    target_sample, target_stride = _ordinal_sample(
        evidence.target.shape[0], MAX_TARGET_DISPLAY_POINTS
    )
    parts = _view_header(evidence, view)
    parts.extend(_grid_elements(bounds, project))
    parts.extend(
        _point_elements(
            evidence.target,
            target_sample,
            view,
            project,
            color="#c084fc",
            opacity=0.52,
        )
    )
    parts.extend(
        _point_elements(
            evidence.transformed_source,
            source_sample,
            view,
            project,
            color="#22d3ee",
            opacity=0.64,
        )
    )
    parts.extend(_residual_elements(evidence, view, project))
    parts.extend(
        [
            f'<text x="900" y="1065" fill="#94a3b8" font-family="monospace" font-size="13" text-anchor="middle">{html.escape(view.horizontal_label)}</text>',
            f'<text x="20" y="595" fill="#94a3b8" font-family="monospace" font-size="13" text-anchor="middle" transform="rotate(-90 20 595)">{html.escape(view.vertical_label)}</text>',
            f'<text x="55" y="1093" fill="#22d3ee" font-family="monospace" font-size="12">● XGRIDS candidate-transformed sample: every {source_stride} ordinal(s), {source_sample.shape[0]:,} points</text>',
            f'<text x="610" y="1093" fill="#c084fc" font-family="monospace" font-size="12">● MatterPak room-9 candidate sample: every {target_stride} ordinal(s), {target_sample.shape[0]:,} points</text>',
        ]
    )
    legend_x = 1200
    for index, (_, _, color, label) in enumerate(RESIDUAL_BANDS):
        x = legend_x + index * 140
        parts.append(f'<line x1="{x}" y1="1089" x2="{x + 24}" y2="1089" stroke="{color}" stroke-width="4"/>')
        parts.append(f'<text x="{x + 30}" y="1093" fill="{color}" font-family="monospace" font-size="11">{label}</text>')
    parts.append('</svg>')
    return ("".join(parts) + "\n").encode("utf-8")


def _histogram_counts(values: np.ndarray, edges: Sequence[float]) -> list[int]:
    if any(
        not left < right
        for left, right in zip(edges[:-1], edges[1:], strict=True)
    ):
        raise ReviewPackError("histogram edges must be strictly increasing")
    counts: list[int] = []
    for index, (left, right) in enumerate(
        zip(edges[:-1], edges[1:], strict=True)
    ):
        if index == len(edges) - 2:
            mask = (values >= left) & (values <= right)
        else:
            mask = (values >= left) & (values < right)
        counts.append(int(np.count_nonzero(mask)))
    if sum(counts) != values.shape[0]:
        raise ReviewPackError("histogram bins do not cover the residual population")
    return counts


def _histogram_panel(
    *, title: str, subtitle: str, counts: Sequence[int], labels: Sequence[str], y_offset: int
) -> Iterable[str]:
    panel_x, panel_width, panel_height = 80, 1640, 270
    baseline = y_offset + panel_height - 45
    maximum = max(counts)
    if maximum <= 0 or len(counts) != len(labels):
        raise ReviewPackError("histogram panel is empty or malformed")
    gap = 12.0
    bar_width = (panel_width - gap * (len(counts) - 1)) / len(counts)
    yield f'<text x="80" y="{y_offset}" fill="#f8fafc" font-family="monospace" font-size="20">{html.escape(title)}</text>'
    yield f'<text x="80" y="{y_offset + 26}" fill="#94a3b8" font-family="monospace" font-size="13">{html.escape(subtitle)}</text>'
    yield f'<line x1="80" y1="{baseline}" x2="1720" y2="{baseline}" stroke="#475569"/>'
    for index, (count, label) in enumerate(zip(counts, labels, strict=True)):
        height = (count / maximum) * (panel_height - 105)
        x = panel_x + index * (bar_width + gap)
        y = baseline - height
        color = "#38bdf8" if index < len(counts) - 1 else "#f97316"
        yield f'<rect x="{x:.3f}" y="{y:.3f}" width="{bar_width:.3f}" height="{height:.3f}" fill="{color}" fill-opacity="0.78"/>'
        yield f'<text x="{x + bar_width / 2:.3f}" y="{y - 8:.3f}" fill="#e2e8f0" font-family="monospace" font-size="12" text-anchor="middle">{count:,}</text>'
        yield f'<text x="{x + bar_width / 2:.3f}" y="{baseline + 20}" fill="#94a3b8" font-family="monospace" font-size="11" text-anchor="middle">{html.escape(label)}</text>'


def _residual_panel_specs(
    evidence: ReviewEvidence,
) -> tuple[tuple[str, str, Sequence[int], Sequence[str], int], ...]:
    mutual_edges = [index / 100.0 for index in range(13)]
    all_edges = [0.0, 0.02, 0.05, 0.08, 0.12, 0.25, 0.5, 1.0, 2.0]
    mutual_counts = _histogram_counts(evidence.mutual_distances, mutual_edges)
    all_clipped = np.minimum(evidence.all_source_distances, 2.0)
    all_counts = _histogram_counts(all_clipped, all_edges)
    mutual_labels = [
        f"{int(left * 1000)}–{int(right * 1000)}"
        for left, right in zip(mutual_edges[:-1], mutual_edges[1:], strict=True)
    ]
    all_labels = [
        "0–20 mm",
        "20–50 mm",
        "50–80 mm",
        "80–120 mm",
        "120–250 mm",
        "250–500 mm",
        "0.5–1 m",
        "1–2+ m",
    ]
    return (
        (
            "Postfit mutual-nearest residuals",
            "All 8,290 exact mutual pairs; 10 mm bins; millimetres; strict residual <120 mm.",
            mutual_counts,
            mutual_labels,
            175,
        ),
        (
            "All selected source → nearest MatterPak room-9-candidate vertices",
            "All 24,977 selected source vertices; last bin includes exact residuals ≥1 m and is visually capped at 2 m only for binning.",
            all_counts,
            all_labels,
            515,
        ),
    )


def _render_residual_summary(evidence: ReviewEvidence) -> bytes:
    coverage = (
        evidence.mutual_distances.shape[0] / evidence.transformed_source.shape[0]
    )
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="900" viewBox="0 0 1800 900">',
        '<rect width="1800" height="900" fill="#020617"/>',
        '<text x="80" y="52" fill="#f8fafc" font-family="monospace" font-size="25">Grand Hall authority-none ICP candidate · residual inventory</text>',
        '<text x="80" y="84" fill="#f59e0b" font-family="monospace" font-size="17">CANDIDATE ONLY · no convergence claim · no transform acceptance · no room-boundary acceptance</text>',
        f'<text x="80" y="116" fill="#fb7185" font-family="monospace" font-size="14">Only {coverage * 100.0:.3f}% ({evidence.mutual_distances.shape[0]:,} / {evidence.transformed_source.shape[0]:,}) of selected source vertices are in the postfit mutual &lt;120 mm set.</text>',
    ]
    for title, subtitle, counts, labels, y_offset in _residual_panel_specs(evidence):
        parts.extend(
            _histogram_panel(
                title=title,
                subtitle=subtitle,
                counts=counts,
                labels=labels,
                y_offset=y_offset,
            )
        )
    parts.extend(
        [
            '<text x="80" y="862" fill="#94a3b8" font-family="monospace" font-size="12">Histograms summarize exact computed residual arrays. They do not establish whether either selected population is the Grand Hall.</text>',
            '</svg>',
        ]
    )
    return ("".join(parts) + "\n").encode("utf-8")


def _readme(evidence: ReviewEvidence) -> bytes:
    coverage = evidence.mutual_distances.shape[0] / evidence.transformed_source.shape[0]
    content = f"""# Grand Hall authority-none ICP candidate visual review

**CANDIDATE ONLY — AUTHORITY NONE — HUMAN REVIEW REQUIRED.**

This pack projects the exact candidate matrix already present in the frozen registration seed. It does not solve, refine, accept, or promote that matrix. It does not establish that MatterPak room 9, the XGRIDS envelope selection, or any pixel/vertex is the Grand Hall. It grants no metric, room-boundary, output-mask, training, reconstruction, runtime, staging, deployment, publication, or architectural authority.

## What the views show

- Cyan points: deterministic ordinal sample of the exact selected XGRIDS BIG OBJ vertices after applying the historical candidate matrix for display only.
- Purple points: deterministic ordinal sample of the exact MatterPak room-9-candidate vertex population.
- Residual lines: all {evidence.mutual_distances.shape[0]:,} postfit mutual-nearest pairs under the strict 120 mm historical threshold, drawn at true geometric length (not exaggerated).
- Residual colours: green 0–20 mm; lime 20–50 mm; amber 50–80 mm; red 80–120 mm.
- The three projections are fixed CVF orthographic views: XY top (Z up), XZ front, and YZ side.
- `04-residual-inventory.svg` shows both the mutual residual distribution and the all-source nearest-target distribution. Only {coverage * 100.0:.3f}% of the selected source population is in the mutual set.

## Human questions this pack can help answer

1. Does the candidate place the same captured structures over one another in all three views?
2. Are residual clusters spatially coherent, or do they reveal scale/orientation/local-warp failure?
3. Do unmatched/tail regions correspond to known cross-room interfaces, capture differences, or a wrong source/target scope?

Those questions require a qualified human reviewing the source captures and boundary evidence. A favourable visual impression is not acceptance. Record any later decision in a separately designed, signed review artifact; never edit this pack.

## Reproduction

Run the generator with the exact source OBJ, exact MatterPak OBJ, and exact frozen registration seed. Build mode refuses an existing output directory and writes the receipt last. Check mode performs no writes and regenerates every payload in memory before comparing exact bytes.

No source paths, timestamps, host identifiers, generated content, or external resources are embedded in this pack.
"""
    return content.replace("\r\n", "\n").encode("utf-8")


def _index_html() -> bytes:
    cards = "\n".join(
        f'<section><h2>{html.escape(view.title)}</h2><object data="{view.file_name}" type="image/svg+xml"></object></section>'
        for view in VIEWS
    )
    document = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grand Hall authority-none ICP candidate review</title>
<style>
html{{color-scheme:dark;background:#020617;color:#e2e8f0;font-family:system-ui,sans-serif}}body{{margin:0 auto;max-width:1840px;padding:28px}}header{{border:2px solid #f59e0b;background:#111827;padding:20px;border-radius:12px}}h1{{margin:0 0 10px}}.warning{{color:#fbbf24;font-weight:800}}.block{{color:#fb7185}}section{{margin:28px 0;background:#0f172a;padding:16px;border:1px solid #334155;border-radius:12px}}object{{display:block;width:100%;aspect-ratio:1800/1120;background:#020617}}section:last-of-type object{{aspect-ratio:2/1}}code{{color:#67e8f9}}</style>
</head>
<body>
<header><h1>Grand Hall ICP candidate visual review</h1><p class="warning">CANDIDATE ONLY · AUTHORITY NONE · NOT AN ACCEPTED TRANSFORM</p><p class="block">Room 9 and the XGRIDS source selection remain human-pending. Nothing here may be used as a room mask, measurement, architectural fact, runtime transform, or publication asset.</p><p>Read <code>README.md</code> and verify <code>receipt.json</code> before review.</p></header>
{cards}
<section><h2>Residual inventory</h2><object data="04-residual-inventory.svg" type="image/svg+xml"></object></section>
</body>
</html>
"""
    return document.replace("\r\n", "\n").encode("utf-8")


def build_payloads(evidence: ReviewEvidence) -> dict[str, bytes]:
    payloads = {view.file_name: _render_view(evidence, view) for view in VIEWS}
    payloads["04-residual-inventory.svg"] = _render_residual_summary(evidence)
    payloads["README.md"] = _readme(evidence)
    payloads["index.html"] = _index_html()
    return dict(sorted(payloads.items()))


def _band_inventory(distances: np.ndarray) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for lower, upper, color, label in RESIDUAL_BANDS:
        count = int(np.count_nonzero((distances >= lower) & (distances < upper)))
        result.append(
            {
                "color": color,
                "count": count,
                "label": label,
                "lowerInclusiveMetresFloat64Hex": _float64_bits(lower),
                "upperExclusiveMetresFloat64Hex": _float64_bits(upper),
            }
        )
    if sum(item["count"] for item in result) != distances.shape[0]:
        raise ReviewPackError("residual band inventory does not cover every mutual pair")
    return result


def _view_receipts(evidence: ReviewEvidence) -> list[dict[str, Any]]:
    source_sample, source_stride = _ordinal_sample(
        evidence.transformed_source.shape[0], MAX_SOURCE_DISPLAY_POINTS
    )
    target_sample, target_stride = _ordinal_sample(
        evidence.target.shape[0], MAX_TARGET_DISPLAY_POINTS
    )
    result: list[dict[str, Any]] = []
    for view in VIEWS:
        left, right, bottom, top = _view_bounds(evidence, view)
        result.append(
            {
                "fileName": view.file_name,
                "horizontalAxis": view.horizontal_label,
                "orthographic": True,
                "residualLines": "all_exact_mutual_pairs_true_geometric_length_not_exaggerated",
                "sourceOrdinalSample": {
                    "count": int(source_sample.shape[0]),
                    "stride": source_stride,
                    "orderedOrdinalsRawSha256": f"sha256:{replay._raw_array_sha256(source_sample, '<i8', name='source display sample')}",
                },
                "targetOrdinalSample": {
                    "count": int(target_sample.shape[0]),
                    "stride": target_stride,
                    "orderedOrdinalsRawSha256": f"sha256:{replay._raw_array_sha256(target_sample, '<i8', name='target display sample')}",
                },
                "verticalAxis": view.vertical_label,
                "viewBoundsFloat64Hex": {
                    "horizontalMaximum": _float64_bits(right),
                    "horizontalMinimum": _float64_bits(left),
                    "verticalMaximum": _float64_bits(top),
                    "verticalMinimum": _float64_bits(bottom),
                },
                "viewId": view.view_id,
            }
        )
    return result


def _file_receipts(payloads: Mapping[str, bytes]) -> list[dict[str, Any]]:
    media_types = {
        ".html": "text/html; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".svg": "image/svg+xml; charset=utf-8",
    }
    return [
        {
            "byteLength": len(payload),
            "fileName": file_name,
            "mediaType": media_types[Path(file_name).suffix],
            "sha256": f"sha256:{_sha256_bytes(payload)}",
        }
        for file_name, payload in sorted(payloads.items())
    ]


def _candidate_receipt(evidence: ReviewEvidence) -> Mapping[str, Any]:
    seed_matrix = _nested(
        evidence.seed, ("finalResult", "candidateArfToCvfRowMajorMatrixFloat64Hex")
    )
    return {
        "candidateArfToCvfRowMajorMatrixFloat64Hex": seed_matrix,
        "convergenceClaimed": False,
        "matrixPermittedUse": "historical_candidate_visual_nomination_aid_only",
        "matrixReSolvedByThisPack": False,
        "matrixUsedAsMeasurement": False,
        "matrixUsedToDisplaySourceInTargetFrame": True,
    }


def _derived_evidence_receipt(evidence: ReviewEvidence) -> Mapping[str, Any]:
    coverage = evidence.mutual_distances.shape[0] / evidence.transformed_source.shape[0]
    return {
        "allSelectedSourceToNearestTarget": {
            "count": int(evidence.all_source_distances.shape[0]),
            "distancesPackedLittleEndianFloat64RawSha256": f"sha256:{ALL_SOURCE_DISTANCE_SHA256}",
        },
        "postfitMutualUnderStrict120Millimetres": {
            "correspondenceCount": int(evidence.mutual_distances.shape[0]),
            "correspondenceCoverageOfSelectedSourceFloat64Hex": _float64_bits(coverage),
            "distancesPackedLittleEndianFloat64RawSha256": f"sha256:{POSTFIT_DISTANCE_SHA256}",
            "orderedSourceTargetPairsPackedLittleEndianInt64RawSha256": f"sha256:{POSTFIT_PAIR_SHA256}",
            "residualBands": _band_inventory(evidence.mutual_distances),
            "thresholdComparison": "strict_less_than",
            "thresholdMetresFloat64Hex": _float64_bits(MUTUAL_THRESHOLD_METRES),
        },
        "selectedSource": {
            "count": int(evidence.transformed_source.shape[0]),
            "finalTransformedPackedLittleEndianFloat64RawSha256": f"sha256:{FINAL_TRANSFORMED_SOURCE_SHA256}",
            "isGrandHallMask": False,
            "selectionAuthority": "none",
        },
    }


def _input_bindings_receipt(evidence: ReviewEvidence) -> Mapping[str, Any]:
    return {
        "registrationSeed": {
            "artifactId": evidence.seed.get("artifactId"),
            "byteLength": evidence.seed_byte_length,
            "canonicalJsonSha256": f"sha256:{SEED_CANONICAL_JSON_SHA256}",
            "fileSha256": f"sha256:{evidence.seed_file_sha256}",
            "semanticSha256": SEED_SEMANTIC_SHA256,
        },
        "sourceBigObj": {
            "byteLength": SOURCE_BYTE_LENGTH,
            "logicalId": replay.SOURCE_LOGICAL_ID,
            "sha256": f"sha256:{SOURCE_SHA256}",
        },
        "targetMatterPakObj": {
            "byteLength": TARGET_BYTE_LENGTH,
            "logicalId": replay.TARGET_LOGICAL_ID,
            "roomSelectionAuthority": "none",
            "sha256": f"sha256:{TARGET_SHA256}",
        },
    }


def _guardrail_receipt() -> Mapping[str, Any]:
    return {
        "acceptedOutputMask": None,
        "acceptedRoomBoundary": None,
        "acceptedTransform": None,
        "generatedArchitecture": False,
        "inputFilesModified": False,
        "permitsCoordinateAcceptance": False,
        "permitsDeployment": False,
        "permitsOutputMasking": False,
        "permitsPublication": False,
        "permitsReconstructionInput": False,
        "permitsRuntimeUse": False,
        "permitsTrainingInput": False,
        "permitsTransformAcceptance": False,
        "sourcePathsIncluded": False,
        "timestampsIncluded": False,
    }


def _method_bindings_receipt(
    generator_sha256: str, replay_sha256: str
) -> Mapping[str, Any]:
    return {
        "generatorImplementationSha256": f"sha256:{generator_sha256}",
        "numpyVersion": np.__version__,
        "pythonImplementation": platform.python_implementation(),
        "pythonVersion": platform.python_version(),
        "replayImplementationSha256": f"sha256:{replay_sha256}",
        "reproductionBoundary": "exact_bytes_require_same_generator_and_numerical_runtime",
        "scipyVersion": replay.scipy.__version__,
        "trimeshVersion": replay.trimesh.__version__,
        "writesReceiptLast": True,
    }


def build_receipt(
    evidence: ReviewEvidence,
    payloads: Mapping[str, bytes],
    *,
    generator_implementation_sha256: str,
    replay_implementation_sha256: str,
) -> Mapping[str, Any]:
    receipt: dict[str, Any] = {
        "artifactId": ARTIFACT_ID,
        "authority": {
            "acceptedTransform": None,
            "architecturalEvidence": False,
            "classification": "none",
            "humanReviewRequiredBeforeAnyPromotion": True,
            "productionTrust": None,
        },
        "candidate": _candidate_receipt(evidence),
        "derivedEvidence": _derived_evidence_receipt(evidence),
        "files": _file_receipts(payloads),
        "guardrails": _guardrail_receipt(),
        "inputBindings": _input_bindings_receipt(evidence),
        "methodBindings": _method_bindings_receipt(
            generator_implementation_sha256, replay_implementation_sha256
        ),
        "rendering": {
            "coordinateFrame": "CVF_candidate_display_only",
            "externalResources": False,
            "generatedContent": False,
            "pointSampling": "fixed_ascending_ordinal_stride",
            "residualVectorScale": "true_geometric_length_no_exaggeration",
            "views": _view_receipts(evidence),
        },
        "schemaVersion": SCHEMA_VERSION,
    }
    receipt["receiptSemanticSha256"] = f"sha256:{_sha256_bytes(_canonical_json_bytes(receipt))}"
    return receipt


def _verify_receipt_self_digest(receipt: Mapping[str, Any]) -> None:
    claimed = receipt.get("receiptSemanticSha256")
    body = dict(receipt)
    body.pop("receiptSemanticSha256", None)
    expected = f"sha256:{_sha256_bytes(_canonical_json_bytes(body))}"
    if claimed != expected:
        raise ReviewPackError("receipt semantic self-digest differs")


def _write_exclusive(path: Path, payload: bytes) -> None:
    binary_flag = getattr(os, "O_BINARY", 0)
    descriptor = os.open(
        path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | binary_flag, 0o600
    )
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _implementation_hashes() -> tuple[str, str]:
    generator_path = Path(__file__).resolve()
    replay_path = Path(replay.__file__).resolve()
    generator_payload, generator_sha = replay._stable_regular_file_snapshot(
        generator_path, label="visual-review generator implementation"
    )
    replay_payload, replay_sha = replay._stable_regular_file_snapshot(
        replay_path, label="ICP replay implementation"
    )
    if len(generator_payload) == 0 or len(replay_payload) == 0:
        raise ReviewPackError("implementation binding is empty")
    if replay_sha != REPLAY_IMPLEMENTATION_SHA256:
        raise ReviewPackError(
            "ICP replay implementation differs from the registration-seed binding"
        )
    return generator_sha, replay_sha


def expected_pack(
    evidence: ReviewEvidence,
) -> tuple[Mapping[str, bytes], bytes, Mapping[str, Any]]:
    payloads = build_payloads(evidence)
    generator_sha, replay_sha = _implementation_hashes()
    receipt = build_receipt(
        evidence,
        payloads,
        generator_implementation_sha256=generator_sha,
        replay_implementation_sha256=replay_sha,
    )
    _verify_receipt_self_digest(receipt)
    receipt_bytes = _canonical_json_bytes(receipt) + b"\n"
    return payloads, receipt_bytes, receipt


def write_pack(
    output_dir: Path,
    payloads: Mapping[str, bytes],
    receipt_bytes: bytes,
    receipt_copy: Path | None,
) -> None:
    try:
        output_dir.mkdir(parents=False, exist_ok=False)
    except FileExistsError as error:
        raise ReviewPackError("output directory already exists; refusing replacement") from error
    for file_name, payload in sorted(payloads.items()):
        _write_exclusive(output_dir / file_name, payload)
    _write_exclusive(output_dir / "receipt.json", receipt_bytes)
    if receipt_copy is not None:
        _write_exclusive(receipt_copy, receipt_bytes)


def check_pack(
    output_dir: Path,
    payloads: Mapping[str, bytes],
    receipt_bytes: bytes,
    receipt_copy: Path | None,
) -> None:
    expected_names = set(payloads) | {"receipt.json"}
    actual_names = {path.name for path in output_dir.iterdir() if path.is_file()}
    if actual_names != expected_names:
        raise ReviewPackError("review-pack file inventory differs from the exact regeneration")
    if any(path.is_dir() for path in output_dir.iterdir()):
        raise ReviewPackError("review pack contains an unexpected directory")
    if any(path.is_symlink() for path in output_dir.iterdir()):
        raise ReviewPackError("review pack contains an unexpected symbolic link")
    for file_name, expected in sorted(payloads.items()):
        actual, _ = replay._stable_regular_file_snapshot(
            output_dir / file_name, label=f"review-pack payload {file_name}"
        )
        if actual != expected:
            raise ReviewPackError(f"review-pack payload differs: {file_name}")
    actual_receipt, _ = replay._stable_regular_file_snapshot(
        output_dir / "receipt.json", label="review-pack receipt"
    )
    if actual_receipt != receipt_bytes:
        raise ReviewPackError("review-pack receipt differs from exact regeneration")
    if receipt_copy is not None:
        copy_payload, _ = replay._stable_regular_file_snapshot(
            receipt_copy, label="repository receipt copy"
        )
        if copy_payload != receipt_bytes:
            raise ReviewPackError("repository receipt copy differs from the pack receipt")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build or verify the source-bound Grand Hall authority-none ICP visual review pack."
    )
    parser.add_argument("mode", choices=("build", "check"))
    parser.add_argument("--source-obj", required=True, type=Path)
    parser.add_argument("--target-obj", required=True, type=Path)
    parser.add_argument("--registration-seed", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--receipt-copy", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    evidence = load_review_evidence(
        arguments.source_obj, arguments.target_obj, arguments.registration_seed
    )
    payloads, receipt_bytes, receipt = expected_pack(evidence)
    if arguments.mode == "build":
        write_pack(arguments.output_dir, payloads, receipt_bytes, arguments.receipt_copy)
    else:
        check_pack(arguments.output_dir, payloads, receipt_bytes, arguments.receipt_copy)
    summary = {
        "artifactId": ARTIFACT_ID,
        "authority": "none",
        "fileCountIncludingReceipt": len(payloads) + 1,
        "mode": arguments.mode,
        "receiptSemanticSha256": receipt["receiptSemanticSha256"],
        "verified": True,
    }
    sys.stdout.buffer.write(_canonical_json_bytes(summary) + b"\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ReviewPackError, replay.ReplayGuardError, OSError) as error:
        sys.stderr.write(f"grand-hall authority-none visual review failed: {error}\n")
        raise SystemExit(1) from error
