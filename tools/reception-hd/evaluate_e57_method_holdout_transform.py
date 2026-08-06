"""Evaluate frozen Reception transforms on the three XYZ-only method holdouts.

This command reads exactly E57 scans 126, 129, and 141 through the pinned
XYZ-only point adapter.  It scores the already-frozen proper and mirror
transforms without fitting, refining, selecting, or otherwise changing either
transform.  The only output is one create-only, authority-none JSON receipt.

The result is a method-specific geometric check.  It is not a globally
pristine holdout after this run, a physical transform approval, a visual
quality decision, a training permission, or a release decision.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import platform
import sys
from types import ModuleType
from typing import Any, Sequence


PINNED_REGISTER_SHA256 = "ad0556344de432fdd9cba793857dd3f71360e34153f621b31e023238b995cd8d"
PINNED_ALIGNMENT_SHA256 = "d8c5b1c00505a9ae3fb90071fe351bf3003330a784f724facb8d67c34761092d"


def _plain_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _load_pinned_register() -> ModuleType:
    path = Path(__file__).resolve().with_name("register_potree_e57.py")
    observed = _plain_file_sha256(path)
    if observed != PINNED_REGISTER_SHA256:
        raise RuntimeError(
            "register_potree_e57.py does not match the evaluator's pinned SHA-256"
        )
    module_name = "_omnitwin_pinned_register_potree_e57_for_method_holdout"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load pinned register_potree_e57.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    inserted = False
    parent = str(path.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)
        inserted = True
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    finally:
        if inserted:
            sys.path.remove(parent)
    helper_path = Path(module.alignment.__file__).resolve()
    if helper_path != path.with_name("align_e57_xgrids.py"):
        raise RuntimeError("pinned register tool imported an unexpected alignment helper")
    if _plain_file_sha256(helper_path) != PINNED_ALIGNMENT_SHA256:
        raise RuntimeError("align_e57_xgrids.py does not match the evaluator's pinned SHA-256")
    return module


BASE = _load_pinned_register()
alignment = BASE.alignment

SCHEMA_VERSION = "omnitwin.reception.e57-method-holdout-transform-evaluation.v1"
RECEIPT_DIGEST_DOMAIN = b"OMNITWIN_RECEPTION_E57_METHOD_HOLDOUT_TRANSFORM_V1\0"
RECEIPT_DIGEST_DOMAIN_LABEL = "OMNITWIN_RECEPTION_E57_METHOD_HOLDOUT_TRANSFORM_V1\\0"

METHOD_HOLDOUT_SCAN_IDS = (126, 129, 141)
FIT_SCAN_IDS = (124, 125, 127, 128, 130, 132, 133, 135, 136, 137, 139, 142, 143, 144)
VALIDATION_SCAN_IDS = (131, 134, 138)
QUARANTINED_SCAN_IDS = (122, 123, 140)
FORBIDDEN_SCAN_IDS = frozenset(FIT_SCAN_IDS + VALIDATION_SCAN_IDS + QUARANTINED_SCAN_IDS)

RECEPTION_E57_SIZE_BYTES = 20_518_437_888
RECEPTION_E57_SHA256 = "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd"
RECEPTION_E57_SCAN_COUNT = 149
RECEPTION_E57_ORGANIZED_ROWS = 1800
RECEPTION_E57_ORGANIZED_COLUMNS = 3600
RECEPTION_E57_ORGANIZED_SAMPLE_STRIDE = 18

POTREE_POINTS = 175_237
POTREE_RECORD_BYTES = 14
POTREE_FILE_PINS = {
    "metadata.json": {
        "sizeBytes": 1_299,
        "sha256": "65e314ff0908ba9a87a4e149f82c3bc76fe529fd0aa63b621c7c69b8e94a0d7e",
    },
    "octree.bin": {
        "sizeBytes": 2_453_318,
        "sha256": "c49eb7a959be867ef27b63ca1e17b36505566a882f359b642b268afb979e98f5",
    },
    "hierarchy.bin": {
        "sizeBytes": 2_046,
        "sha256": "40d1fe4a74f7cd5f92ec6752bc9f5aebe5ba262795da8748c00363017f76e21b",
    },
}

# These are the current base diagnostic's exact default scoring settings.
# They are deliberately not CLI knobs, so the method holdout cannot be tuned
# after looking at its result.
POTREE_SAMPLE_POINT_LIMIT = POTREE_POINTS
E57_POINTS_PER_SCAN_LIMIT = 2_000
OVERLAP_DISTANCE_METERS = 0.20

FROZEN_TRANSFORM_RECEIPT_SCHEMA = (
    "omnitwin.reception.potree-e57-validation-proper-vs-mirror.v0"
)
FROZEN_TRANSFORM_RECEIPT_FILE_SHA256 = (
    "81dadda64ba0a25c0d073ce60ee8d9bf39baa166aaa8a46cd3d859eaacaa9927"
)
FROZEN_TRANSFORM_RECEIPT_PAYLOAD_SHA256 = (
    "6efde23f40da53cf8c20f65aef1b7656ac49daf7e5413a7ca9e9444ec374aa50"
)
MAX_FROZEN_RECEIPT_BYTES = 2 * 1024 * 1024

FROZEN_PROPER_ROTATION = (
    (-0.9767424772079121, -0.2144157951685259, 0.0),
    (0.2144157951685259, -0.9767424772079121, 0.0),
    (0.0, 0.0, 1.0),
)
FROZEN_PROPER_TRANSLATION = (
    13.129636870981638,
    1.8645790764845938,
    -1.4672480408373136,
)
FROZEN_MIRROR_ROTATION = (
    (0.9566351364389708, 0.29128888706984973, 0.0),
    (0.29128888706984973, -0.9566351364389708, 0.0),
    (0.0, 0.0, 1.0),
)
FROZEN_MIRROR_TRANSLATION = (
    19.758729611588528,
    2.072867853733843,
    -1.4672480408373136,
)


def fail(code: str, message: str) -> None:
    alignment.fail(code, message)


def _snapshot_evidence(snapshot: Any) -> dict[str, Any]:
    return BASE._snapshot_evidence(snapshot)


def _verify_pinned_contract() -> None:
    expected_partitions = {
        "fit": FIT_SCAN_IDS,
        "validation": VALIDATION_SCAN_IDS,
        "test": METHOD_HOLDOUT_SCAN_IDS,
        "quarantine": QUARANTINED_SCAN_IDS,
    }
    base_partitions = {
        "fit": tuple(BASE.FIT_SCAN_IDS),
        "validation": tuple(BASE.VALIDATION_SCAN_IDS),
        "test": tuple(BASE.FROZEN_TEST_SCAN_IDS),
        "quarantine": tuple(BASE.QUARANTINED_SCAN_IDS),
    }
    helper_partitions = {
        "fit": tuple(alignment.FROZEN_FIT_SCAN_IDS),
        "validation": tuple(alignment.FROZEN_VALIDATION_SCAN_IDS),
        "test": tuple(alignment.FROZEN_TEST_SCAN_IDS),
        "quarantine": tuple(alignment.FROZEN_QUARANTINED_SCAN_IDS),
    }
    if base_partitions != expected_partitions or helper_partitions != expected_partitions:
        fail("PINNED_SCAN_SCOPE_DRIFT", "base diagnostic scan partitions changed")
    if set(METHOD_HOLDOUT_SCAN_IDS) & FORBIDDEN_SCAN_IDS:
        fail("INTERNAL_SCAN_FIREWALL_ERROR", "method holdout overlaps a forbidden scan split")
    if (
        BASE.RECEPTION_E57_SIZE_BYTES != RECEPTION_E57_SIZE_BYTES
        or BASE.RECEPTION_E57_SHA256 != RECEPTION_E57_SHA256
        or alignment.RECEPTION_E57_SIZE_BYTES != RECEPTION_E57_SIZE_BYTES
        or alignment.RECEPTION_E57_SHA256 != RECEPTION_E57_SHA256
        or alignment.RECEPTION_E57_SCAN_COUNT != RECEPTION_E57_SCAN_COUNT
        or alignment.RECEPTION_E57_ORGANIZED_ROWS != RECEPTION_E57_ORGANIZED_ROWS
        or alignment.RECEPTION_E57_ORGANIZED_COLUMNS != RECEPTION_E57_ORGANIZED_COLUMNS
        or alignment.RECEPTION_E57_ORGANIZED_SAMPLE_STRIDE
        != RECEPTION_E57_ORGANIZED_SAMPLE_STRIDE
    ):
        fail("PINNED_E57_FACT_DRIFT", "base diagnostic E57 facts changed")
    if (
        BASE.POTREE_POINTS != POTREE_POINTS
        or BASE.POTREE_RECORD_BYTES != POTREE_RECORD_BYTES
        or BASE.POTREE_FILE_PINS != POTREE_FILE_PINS
    ):
        fail("PINNED_POTREE_FACT_DRIFT", "base diagnostic Potree facts changed")
    required = (
        BASE.load_potree_model,
        BASE._source_binding,
        BASE._verify_small_sources_unchanged,
        BASE._metric_comparison,
        BASE._transform_evidence,
        BASE._publish_receipt,
        alignment.Pye57PointAdapter,
        alignment._read_e57_point_samples,
        alignment._evaluate_bidirectional,
    )
    if any(not callable(value) for value in required):
        fail("PINNED_HELPER_API_DRIFT", "a required read-only scoring helper is missing")


def _as_exact_scan_key(raw: Any, field: str) -> int:
    if isinstance(raw, bool):
        fail("E57_ADAPTER_SCAN_SCOPE_MISMATCH", f"{field} contains a boolean scan key")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str):
        try:
            parsed = int(raw, 10)
        except ValueError:
            parsed = -1
        if raw == str(parsed):
            return parsed
    fail("E57_ADAPTER_SCAN_SCOPE_MISMATCH", f"{field} has a non-canonical scan key")
    raise AssertionError("unreachable")


class _XYZOnlyExactScopeAdapter:
    """Enforce one XYZ-only adapter call for exactly the method-holdout scans."""

    _RESULT_KEYS = {
        "adapter",
        "scanCount",
        "rawPointCounts",
        "organizedSampling",
        "pointsByScan",
    }

    def __init__(self, delegate: Any) -> None:
        self._delegate = delegate
        self.call_count = 0

    @staticmethod
    def _exact_keys(value: Any, field: str) -> set[int]:
        if not isinstance(value, dict):
            fail("INVALID_E57_ADAPTER", f"E57 adapter {field} must be an object")
        result: set[int] = set()
        for raw in value:
            scan_id = _as_exact_scan_key(raw, field)
            if scan_id in result:
                fail(
                    "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                    f"{field} has duplicate representations of scan {scan_id}",
                )
            result.add(scan_id)
        return result

    def read_samples(
        self, path: Path, scan_ids: Sequence[int], per_scan_limit: int
    ) -> dict[str, Any]:
        self.call_count += 1
        if self.call_count != 1:
            fail("E57_ADAPTER_CALL_COUNT_MISMATCH", "E57 adapter was called more than once")
        if tuple(scan_ids) != METHOD_HOLDOUT_SCAN_IDS:
            fail(
                "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                "E57 helper requested scans other than exactly 126, 129, and 141",
            )
        if per_scan_limit != E57_POINTS_PER_SCAN_LIMIT:
            fail("E57_SAMPLING_DRIFT", "E57 point limit differs from the frozen method")
        result = self._delegate.read_samples(path, tuple(scan_ids), per_scan_limit)
        if not isinstance(result, dict):
            fail("INVALID_E57_ADAPTER", "E57 point adapter returned a non-object")
        if set(result) != self._RESULT_KEYS:
            fail(
                "INVALID_E57_ADAPTER_KEYS",
                "E57 adapter result must contain only XYZ point-sampling evidence fields",
            )
        expected = set(METHOD_HOLDOUT_SCAN_IDS)
        for field in ("pointsByScan", "rawPointCounts", "organizedSampling"):
            if self._exact_keys(result.get(field), field) != expected:
                fail(
                    "E57_ADAPTER_SCAN_SCOPE_MISMATCH",
                    f"{field} must contain exactly scans 126, 129, and 141",
                )
        return result


def _require_dict(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        fail("INVALID_FROZEN_TRANSFORM_RECEIPT", f"{label} must be an object")
    return value


def _require_exact_list(value: Any, expected: Sequence[int], label: str) -> None:
    if value != list(expected):
        fail("INVALID_FROZEN_TRANSFORM_SCOPE", f"{label} differs from the frozen scope")


def _parse_frozen_transform(
    candidate: Any,
    *,
    label: str,
    expected_rotation: Sequence[Sequence[float]],
    expected_translation: Sequence[float],
    determinant_sign: int,
    np: Any,
) -> tuple[Any, Any]:
    row = _require_dict(candidate, label)
    rotation = np.asarray(row.get("rotationRowMajor"), dtype=np.float64)
    translation = np.asarray(row.get("translationMeters"), dtype=np.float64)
    if rotation.shape != (3, 3) or translation.shape != (3,):
        fail("INVALID_FROZEN_TRANSFORM", f"{label} must contain a 3x3 rotation and xyz translation")
    if not np.all(np.isfinite(rotation)) or not np.all(np.isfinite(translation)):
        fail("INVALID_FROZEN_TRANSFORM", f"{label} contains non-finite values")
    if not np.array_equal(rotation, np.asarray(expected_rotation, dtype=np.float64)) or not np.array_equal(
        translation, np.asarray(expected_translation, dtype=np.float64)
    ):
        fail("FROZEN_TRANSFORM_VALUE_MISMATCH", f"{label} differs from the pinned frozen transform")
    identity_error = float(np.max(np.abs(rotation.T @ rotation - np.eye(3))))
    determinant = float(np.linalg.det(rotation))
    if identity_error > 1e-12 or determinant * determinant_sign <= 0.0:
        fail("INVALID_FROZEN_TRANSFORM", f"{label} is not in its pinned orthogonal family")
    return rotation, translation


def _load_frozen_transform_receipt(
    path: Path, *, enforce_production_pins: bool, np: Any
) -> tuple[Path, Any, dict[str, Any], dict[str, Any], tuple[Any, Any], tuple[Any, Any]]:
    resolved, snapshot, payload, file_sha256 = alignment._read_bound_bytes(
        path, "frozen transform receipt", MAX_FROZEN_RECEIPT_BYTES
    )
    document = alignment._strict_json(payload, "frozen transform receipt")
    if enforce_production_pins and file_sha256 != FROZEN_TRANSFORM_RECEIPT_FILE_SHA256:
        fail(
            "FROZEN_TRANSFORM_RECEIPT_FILE_MISMATCH",
            "transform receipt bytes differ from the exact frozen receipt",
        )
    if document.get("schemaVersion") != FROZEN_TRANSFORM_RECEIPT_SCHEMA:
        fail("INVALID_FROZEN_TRANSFORM_RECEIPT", "transform receipt schema differs")
    if document.get("authority") != "none":
        fail("INVALID_FROZEN_TRANSFORM_RECEIPT", "transform receipt authority must be none")
    payload_sha256 = document.get("payloadSha256")
    if not isinstance(payload_sha256, str) or len(payload_sha256) != 64:
        fail("INVALID_FROZEN_TRANSFORM_RECEIPT", "transform receipt has no valid payload digest")
    unsigned = copy.deepcopy(document)
    unsigned.pop("payloadSha256", None)
    computed_payload_sha256 = hashlib.sha256(
        alignment._canonical_json_bytes(unsigned)
    ).hexdigest()
    if computed_payload_sha256 != payload_sha256:
        fail("FROZEN_TRANSFORM_RECEIPT_DIGEST_MISMATCH", "transform receipt self-digest is invalid")
    if enforce_production_pins and payload_sha256 != FROZEN_TRANSFORM_RECEIPT_PAYLOAD_SHA256:
        fail("FROZEN_TRANSFORM_RECEIPT_PAYLOAD_MISMATCH", "transform receipt payload differs")

    scope = _require_dict(document.get("scope"), "transform receipt scope")
    _require_exact_list(scope.get("frozenTestScanIdsNotRead"), METHOD_HOLDOUT_SCAN_IDS, "frozen tests")
    _require_exact_list(scope.get("fitScanIdsNotReread"), FIT_SCAN_IDS, "fit scans")
    _require_exact_list(scope.get("validationScanIdsRead"), VALIDATION_SCAN_IDS, "validation scans")
    _require_exact_list(scope.get("excludedScanIdsNotRead"), QUARANTINED_SCAN_IDS, "quarantined scans")
    for field in (
        "fitTransformChangedOrRefit",
        "qualityCandidatesRenderedOrScored",
        "sourceFilesMutated",
    ):
        if scope.get(field) is not False:
            fail("INVALID_FROZEN_TRANSFORM_SCOPE", f"transform receipt {field} must be false")
    if scope.get("e57StationGeometryReadSetExactlyEqualsValidationSet") is not True:
        fail("INVALID_FROZEN_TRANSFORM_SCOPE", "receipt did not enforce validation-only geometry")

    inputs = _require_dict(document.get("inputs"), "transform receipt inputs")
    e57 = _require_dict(inputs.get("e57"), "transform receipt E57 input")
    potree = _require_dict(inputs.get("potree"), "transform receipt Potree input")
    if (
        e57.get("sizeBytes") != RECEPTION_E57_SIZE_BYTES
        or e57.get("knownPinnedSha256NotRehashed") != RECEPTION_E57_SHA256
    ):
        fail("INVALID_FROZEN_TRANSFORM_INPUT", "transform receipt E57 identity differs")
    if (
        potree.get("declaredPointCount") != POTREE_POINTS
        or potree.get("decodedPointCount") != POTREE_POINTS
        or potree.get("pointRecordStrideBytes") != POTREE_RECORD_BYTES
        or potree.get("sha256")
        != {name: POTREE_FILE_PINS[name]["sha256"] for name in POTREE_FILE_PINS}
    ):
        fail("INVALID_FROZEN_TRANSFORM_INPUT", "transform receipt Potree identity differs")

    proper = _parse_frozen_transform(
        document.get("proper"),
        label="proper transform",
        expected_rotation=FROZEN_PROPER_ROTATION,
        expected_translation=FROZEN_PROPER_TRANSLATION,
        determinant_sign=1,
        np=np,
    )
    mirror = _parse_frozen_transform(
        document.get("mirrorCompetitor"),
        label="mirror transform",
        expected_rotation=FROZEN_MIRROR_ROTATION,
        expected_translation=FROZEN_MIRROR_TRANSLATION,
        determinant_sign=-1,
        np=np,
    )
    evidence = {
        "path": str(resolved),
        "schemaVersion": document["schemaVersion"],
        "authority": document["authority"],
        "fileSha256": file_sha256,
        "payloadSha256": payload_sha256,
        "fullyHashedBeforeAndAfterEvaluation": True,
        "snapshot": _snapshot_evidence(snapshot),
        "predatesMethodHoldoutGeometryRead": True,
        "statesMethodHoldoutWasUnread": True,
    }
    return resolved, snapshot, document, evidence, proper, mirror


def _method_comparison(
    proper: dict[str, Any], mirror: dict[str, Any], *, label: str
) -> dict[str, Any]:
    comparison = BASE._metric_comparison(proper, mirror)
    comparison["comparisonMetric"] = (
        f"{label} combined bidirectional nearest-neighbour RMSE"
    )
    proper_rmse = float(comparison["properCombinedRmseMeters"])
    mirror_rmse = float(comparison["mirrorCombinedRmseMeters"])
    comparison["properHasLowerRawCombinedRmse"] = proper_rmse < mirror_rmse
    comparison["properBeatsMirrorBeyondAmbiguityTolerance"] = (
        comparison["samplePreference"] == "proper_lower_validation_rmse"
    )
    comparison["isPhysicalHandednessDecision"] = False
    comparison["isTransformApproval"] = False
    return comparison


def _candidate_score(
    source: Any,
    target: Any,
    proper: tuple[Any, Any],
    mirror: tuple[Any, Any],
    *,
    label: str,
    np: Any,
    cKDTree: Any,
) -> dict[str, Any]:
    proper_metrics = alignment._evaluate_bidirectional(
        source,
        target,
        proper[0],
        proper[1],
        OVERLAP_DISTANCE_METERS,
        np,
        cKDTree,
    )
    mirror_metrics = alignment._evaluate_bidirectional(
        source,
        target,
        mirror[0],
        mirror[1],
        OVERLAP_DISTANCE_METERS,
        np,
        cKDTree,
    )
    return {
        "properFrozenTransformMetrics": proper_metrics,
        "mirrorFrozenTransformMetrics": mirror_metrics,
        "comparison": _method_comparison(proper_metrics, mirror_metrics, label=label),
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


def run_evaluator(
    arguments: argparse.Namespace,
    *,
    e57_adapter: Any | None = None,
    enforce_production_pins: bool = True,
    _test_only_allow_custom_e57_adapter: bool = False,
    _write_hook: Any | None = None,
) -> dict[str, Any]:
    _verify_pinned_contract()
    test_adapter_mode = e57_adapter is not None
    if test_adapter_mode and (
        enforce_production_pins or not _test_only_allow_custom_e57_adapter
    ):
        fail(
            "CUSTOM_E57_ADAPTER_FORBIDDEN",
            "custom E57 adapters require the internal test-only switch and disabled production pins",
        )
    if _test_only_allow_custom_e57_adapter and not test_adapter_mode:
        fail("INVALID_TEST_ADAPTER_MODE", "test-only switch requires a custom adapter")

    np, _scipy, cKDTree, dependency_versions = alignment._load_geometry_dependencies()
    tool_path, tool_snapshot, tool_evidence = BASE._source_binding(
        Path(__file__), "method-holdout evaluator source"
    )
    base_path, base_snapshot, base_evidence = BASE._source_binding(
        Path(BASE.__file__), "pinned register diagnostic source"
    )
    helper_path, helper_snapshot, helper_evidence = BASE._source_binding(
        Path(alignment.__file__), "pinned alignment helper source"
    )
    if base_evidence["sha256"] != PINNED_REGISTER_SHA256:
        fail("PINNED_REGISTER_SOURCE_CHANGED", "register diagnostic source changed")
    if helper_evidence["sha256"] != PINNED_ALIGNMENT_SHA256:
        fail("PINNED_ALIGNMENT_SOURCE_CHANGED", "alignment helper source changed")

    transform_path, transform_snapshot, _transform_document, transform_evidence, proper, mirror = (
        _load_frozen_transform_receipt(
            Path(arguments.transform_receipt),
            enforce_production_pins=enforce_production_pins,
            np=np,
        )
    )
    potree = BASE.load_potree_model(
        Path(arguments.potree_model),
        sample_limit=POTREE_SAMPLE_POINT_LIMIT,
        np=np,
        enforce_production_pins=enforce_production_pins,
    )
    e57_path, e57_snapshot = alignment._safe_regular_file(
        Path(arguments.e57), "Reception E57", alignment.MAX_E57_BYTES
    )
    if enforce_production_pins and e57_snapshot.size_bytes != RECEPTION_E57_SIZE_BYTES:
        fail("E57_SIZE_MISMATCH", "Reception E57 size differs from the frozen identity")
    e57_before_sha256: str | None = None
    if arguments.verify_e57_bytes:
        e57_before_sha256 = alignment._hash_file(e57_path, e57_snapshot, "Reception E57")
        if enforce_production_pins and e57_before_sha256 != RECEPTION_E57_SHA256:
            fail("E57_SHA256_MISMATCH", "Reception E57 bytes differ from the frozen identity")

    selected_adapter = e57_adapter if e57_adapter is not None else alignment.Pye57PointAdapter()
    if not test_adapter_mode and type(selected_adapter) is not alignment.Pye57PointAdapter:
        fail("PRODUCTION_E57_ADAPTER_MISMATCH", "production must use the pinned XYZ-only adapter")
    strict_adapter = _XYZOnlyExactScopeAdapter(selected_adapter)
    points_by_scan, e57_read = alignment._read_e57_point_samples(
        e57_path,
        e57_snapshot,
        METHOD_HOLDOUT_SCAN_IDS,
        E57_POINTS_PER_SCAN_LIMIT,
        np,
        strict_adapter,
    )
    if strict_adapter.call_count != 1 or tuple(points_by_scan) != METHOD_HOLDOUT_SCAN_IDS:
        fail("E57_SCAN_FIREWALL_BREACH", "reader did not return exactly one ordered holdout set")
    if test_adapter_mode:
        e57_read = copy.deepcopy(e57_read)
        e57_read["openMode"] = "unestablished_custom_test_adapter"
        e57_read["customAdapterSideEffectsEstablished"] = False

    source = potree.sampled_points
    per_scan: list[dict[str, Any]] = []
    for scan_id in METHOD_HOLDOUT_SCAN_IDS:
        score = _candidate_score(
            source,
            points_by_scan[scan_id],
            proper,
            mirror,
            label=f"method-holdout scan {scan_id}",
            np=np,
            cKDTree=cKDTree,
        )
        per_scan.append(
            {
                "scanId": scan_id,
                "targetSamplePointCount": int(points_by_scan[scan_id].shape[0]),
                **score,
            }
        )
    combined_target = np.vstack([points_by_scan[scan_id] for scan_id in METHOD_HOLDOUT_SCAN_IDS])
    combined = _candidate_score(
        source,
        combined_target,
        proper,
        mirror,
        label="combined method-holdout scans 126, 129, and 141",
        np=np,
        cKDTree=cKDTree,
    )
    combined["targetSamplePointCount"] = int(combined_target.shape[0])

    alignment._snapshot_matches(e57_path, e57_snapshot, "Reception E57")
    small_sources = (
        (tool_path, tool_snapshot, "method-holdout evaluator source", tool_evidence["sha256"]),
        (base_path, base_snapshot, "pinned register diagnostic source", base_evidence["sha256"]),
        (helper_path, helper_snapshot, "pinned alignment helper source", helper_evidence["sha256"]),
        (
            transform_path,
            transform_snapshot,
            "frozen transform receipt",
            transform_evidence["fileSha256"],
        ),
    )
    BASE._verify_small_sources_unchanged(potree, small_sources)
    if e57_before_sha256 is not None:
        e57_after_sha256 = alignment._hash_file(e57_path, e57_snapshot, "Reception E57")
        if e57_after_sha256 != e57_before_sha256:
            fail("FILE_CHANGED_DURING_RUN", "Reception E57 bytes changed during evaluation")

    production_read_claims = not test_adapter_mode
    combined_comparison = combined["comparison"]
    document = {
        "schemaVersion": SCHEMA_VERSION,
        "status": (
            "method_holdout_evaluated_test_adapter_unusable_authority_none"
            if test_adapter_mode
            else "method_holdout_evaluated_authority_none"
        ),
        "authority": "none",
        "resultType": (
            "test_adapter_result_unusable_as_evidence"
            if test_adapter_mode
            else "read_only_method_specific_geometric_evaluation_not_transform_approval"
        ),
        "scope": {
            "roomLabel": "Reception Room",
            "methodSpecificHoldoutEvaluation": True,
            "globallyPristineHoldoutAfterThisEvaluation": False,
            "methodHoldoutScanIds": list(METHOD_HOLDOUT_SCAN_IDS),
            "exactE57ScanIdsRequested": list(METHOD_HOLDOUT_SCAN_IDS),
            "fitScanIdsNotRequested": list(FIT_SCAN_IDS),
            "validationScanIdsNotRequested": list(VALIDATION_SCAN_IDS),
            "quarantinedScanIdsNotRequested": list(QUARANTINED_SCAN_IDS),
            "readSetEnforcedAtRawAdapterBoundary": True,
            "productionReadSetExactlyEqualsMethodHoldout": (
                True if production_read_claims else None
            ),
            "onlyXYZStationGeometryRequested": True,
            "e57ColorRequested": False,
            "e57IntensityRequested": False,
            "e57Image2DOrPhotographRequested": False,
            "testOnlyCustomAdapterMode": test_adapter_mode,
            "customAdapterSideEffectsEstablished": production_read_claims,
        },
        "inputEvidence": {
            "potreePreview": potree.evidence,
            "e57": {
                "path": str(e57_path),
                "snapshot": _snapshot_evidence(e57_snapshot),
                "frozenExpectedSizeBytes": RECEPTION_E57_SIZE_BYTES,
                "frozenExpectedSha256": RECEPTION_E57_SHA256,
                "currentBytesFullyHashedBeforeAndAfter": e57_before_sha256 is not None,
                "currentFullSha256": e57_before_sha256,
                "adapterExecutionMode": (
                    "internal_test_only_untrusted"
                    if test_adapter_mode
                    else "pinned_production_xyz_only_adapter"
                ),
                "readEvidence": e57_read,
            },
            "frozenTransformReceipt": transform_evidence,
            "code": {
                "methodHoldoutEvaluator": tool_evidence,
                "pinnedRegisterDiagnostic": base_evidence,
                "pinnedAlignmentHelper": helper_evidence,
                "sourceBytesFullyHashedBeforeAndAfter": True,
            },
        },
        "frozenCandidates": {
            "source": "existing validation receipt pinned before method-holdout geometry was read",
            "transformFitRefitRefinementOrOptimizationPerformed": False,
            "holdoutGeometryUsedToChangeEitherTransform": False,
            "scale": 1.0,
            "scaleFitted": False,
            "proper": BASE._transform_evidence(proper[0], proper[1], np, determinant_sign=1),
            "mirrorNegativeControl": BASE._transform_evidence(
                mirror[0], mirror[1], np, determinant_sign=-1
            ),
        },
        "evaluation": {
            "dependencies": dependency_versions,
            "method": {
                "potreeSamplePointLimit": POTREE_SAMPLE_POINT_LIMIT,
                "potreeActualSamplePointCount": int(source.shape[0]),
                "e57PointLimitPerScan": E57_POINTS_PER_SCAN_LIMIT,
                "organizedGridRows": RECEPTION_E57_ORGANIZED_ROWS,
                "organizedGridColumns": RECEPTION_E57_ORGANIZED_COLUMNS,
                "organizedGridStride": RECEPTION_E57_ORGANIZED_SAMPLE_STRIDE,
                "overlapDistanceMeters": OVERLAP_DISTANCE_METERS,
                "metrics": "base diagnostic bidirectional nearest-neighbour statistics and ambiguity rule",
                "postHoldoutTuningPermittedOrPerformed": False,
            },
            "perScan": per_scan,
            "combined": combined,
            "properHasLowerCombinedRawRmse": combined_comparison[
                "properHasLowerRawCombinedRmse"
            ],
            "properBeatsMirrorBeyondAmbiguityTolerance": combined_comparison[
                "properBeatsMirrorBeyondAmbiguityTolerance"
            ],
            "physicalHandednessApproved": False,
            "transformApproved": False,
            "units": "metres assumed for both sources; frozen scale is exactly 1",
        },
        "safety": {
            "sourceMutationPermitted": False,
            "sourceMutationPerformed": False if production_read_claims else None,
            "derivedGeometryImageOrModelCreated": False if production_read_claims else None,
            "transformArtifactCreatedRegisteredOrSigned": False,
            "trainingPermitted": False,
            "trainingPerformed": False if production_read_claims else None,
            "networkProviderPublicationOrPromotionPermitted": False,
            "networkProviderPublicationOrPromotionPerformed": (
                False if production_read_claims else None
            ),
            "physicalApprovalGranted": False,
            "outputPolicy": (
                "one create-only authority-none JSON receipt; no source-derived geometry bytes"
                if production_read_claims
                else "test-only receipt; custom adapter side effects unestablished; unusable as evidence"
            ),
        },
        "eligibility": {
            "eligibleForTraining": False,
            "eligibleForRuntimeUse": False,
            "eligibleForPublicUse": False,
            "eligibleForTransformRegistration": False,
            "eligibleForPhysicalApproval": False,
            "eligibleForEvidenceUse": False if test_adapter_mode else None,
            "requiresIndependentSurveyedControlsAndHumanReview": True,
        },
        "limitations": [
            "This is a method-specific holdout check; these scans are no longer globally pristine after evaluation.",
            "Nearest-neighbour agreement can be fooled by repeated surfaces and incomplete coverage.",
            "A proper-versus-mirror score does not prove physical handedness or transform accuracy.",
            "The Potree cloud is a vendor-produced decimated preview, not raw LiDAR.",
            "No E57 photograph, visual-quality candidate, or Image2D object is read or scored by the production adapter.",
            "The receipt digest is not a signature and proves neither creator nor time.",
        ],
        "runtime": {"python": platform.python_version(), "platform": platform.platform()},
    }
    if test_adapter_mode:
        document["limitations"].append(
            "A custom test adapter ran arbitrary Python, so its reads and side effects are unestablished."
        )
    sealed = _seal_receipt(document)
    protected_paths = tuple(potree.paths.values()) + (
        e57_path,
        transform_path,
        tool_path,
        base_path,
        helper_path,
    )
    protected_roots = (
        potree.root,
        e57_path.parent,
        transform_path.parent,
        tool_path.parent,
    )
    BASE._publish_receipt(
        Path(arguments.output),
        sealed,
        protected_paths,
        protected_roots,
        _write_hook=_write_hook,
    )
    return sealed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--potree-model", required=True, type=Path)
    parser.add_argument("--e57", required=True, type=Path)
    parser.add_argument("--transform-receipt", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--verify-e57-bytes",
        action="store_true",
        help="read and SHA-256 all 20.5 GB before and after XYZ sampling",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    try:
        arguments = build_parser().parse_args(argv)
        receipt = run_evaluator(arguments)
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
