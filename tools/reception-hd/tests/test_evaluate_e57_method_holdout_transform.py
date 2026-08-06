from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock

import numpy as np


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

import evaluate_e57_method_holdout_transform as evaluator  # noqa: E402


def _fixture_records(count: int = 80) -> tuple[bytes, np.ndarray, list[int], list[int]]:
    raw = np.asarray(
        [
            [
                100 + (index * 37 + index * index * 3) % 1_500,
                200 + (index * 53 + index * index * 11) % 1_300,
                300 + (index * 17 + index * index * 7) % 900,
            ]
            for index in range(count)
        ],
        dtype=np.int32,
    )
    intensity = [1 + index for index in range(count)]
    prediction = [20 + index for index in range(count)]
    payload = b"".join(
        struct.pack(
            "<iiiBB",
            int(raw[index, 0]),
            int(raw[index, 1]),
            int(raw[index, 2]),
            intensity[index],
            prediction[index],
        )
        for index in range(count)
    )
    points = raw.astype(np.float64) * np.asarray([0.001, 0.001, 0.001])
    points += np.asarray([-2.0, -3.0, -1.0])
    return payload, points, intensity, prediction


def _write_fixture_model(root: Path) -> tuple[Path, np.ndarray]:
    model = root / "model"
    model.mkdir(parents=True)
    octree, points, intensity, prediction = _fixture_records()
    metadata = {
        "version": "2.0",
        "name": "potree",
        "description": "method-holdout unit fixture",
        "points": int(points.shape[0]),
        "projection": "",
        "hierarchy": {"firstChunkSize": 22, "stepSize": 4, "depth": 0},
        "offset": [-2.0, -3.0, -1.0],
        "scale": [0.001, 0.001, 0.001],
        "spacing": 0.125,
        "boundingBox": {"min": [-2.0, -3.0, -1.0], "max": [1.0, 0.0, 2.0]},
        "encoding": "DEFAULT",
        "attributes": [
            {
                "name": "position",
                "description": "",
                "size": 12,
                "numElements": 3,
                "elementSize": 4,
                "type": "int32",
                "min": [float(value) for value in np.min(points, axis=0)],
                "max": [float(value) for value in np.max(points, axis=0)],
                "scale": [1, 1, 1],
                "offset": [0, 0, 0],
            },
            {
                "name": "intensity",
                "description": "",
                "size": 1,
                "numElements": 1,
                "elementSize": 1,
                "type": "uint8",
                "min": [min(intensity)],
                "max": [max(intensity)],
                "scale": [1],
                "offset": [0],
            },
            {
                "name": "lcc prediction",
                "description": "",
                "size": 1,
                "numElements": 1,
                "elementSize": 1,
                "type": "uint8",
                "min": [min(prediction)],
                "max": [max(prediction)],
                "scale": [1],
                "offset": [0],
            },
        ],
    }
    (model / "metadata.json").write_text(
        json.dumps(metadata, separators=(",", ":")), encoding="utf-8"
    )
    (model / "octree.bin").write_bytes(octree)
    (model / "hierarchy.bin").write_bytes(
        struct.pack("<BBIQQ", 1, 0, len(points), 0, len(octree))
    )
    return model, points


def _frozen_receipt_document() -> dict[str, object]:
    document: dict[str, object] = {
        "schemaVersion": evaluator.FROZEN_TRANSFORM_RECEIPT_SCHEMA,
        "authority": "none",
        "scope": {
            "frozenTestScanIdsNotRead": list(evaluator.METHOD_HOLDOUT_SCAN_IDS),
            "fitScanIdsNotReread": list(evaluator.FIT_SCAN_IDS),
            "validationScanIdsRead": list(evaluator.VALIDATION_SCAN_IDS),
            "excludedScanIdsNotRead": list(evaluator.QUARANTINED_SCAN_IDS),
            "fitTransformChangedOrRefit": False,
            "qualityCandidatesRenderedOrScored": False,
            "sourceFilesMutated": False,
            "e57StationGeometryReadSetExactlyEqualsValidationSet": True,
        },
        "inputs": {
            "e57": {
                "sizeBytes": evaluator.RECEPTION_E57_SIZE_BYTES,
                "knownPinnedSha256NotRehashed": evaluator.RECEPTION_E57_SHA256,
            },
            "potree": {
                "declaredPointCount": evaluator.POTREE_POINTS,
                "decodedPointCount": evaluator.POTREE_POINTS,
                "pointRecordStrideBytes": evaluator.POTREE_RECORD_BYTES,
                "sha256": {
                    name: row["sha256"] for name, row in evaluator.POTREE_FILE_PINS.items()
                },
            },
        },
        "proper": {
            "rotationRowMajor": [list(row) for row in evaluator.FROZEN_PROPER_ROTATION],
            "translationMeters": list(evaluator.FROZEN_PROPER_TRANSLATION),
        },
        "mirrorCompetitor": {
            "rotationRowMajor": [list(row) for row in evaluator.FROZEN_MIRROR_ROTATION],
            "translationMeters": list(evaluator.FROZEN_MIRROR_TRANSLATION),
        },
    }
    document["payloadSha256"] = hashlib.sha256(
        evaluator.alignment._canonical_json_bytes(document)
    ).hexdigest()
    return document


def _write_frozen_receipt(path: Path, document: dict[str, object] | None = None) -> None:
    value = _frozen_receipt_document() if document is None else document
    path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")


class SyntheticXYZAdapter:
    def __init__(
        self,
        source: np.ndarray,
        *,
        extra_scan: int | None = None,
        mutation: object | None = None,
    ) -> None:
        rotation = np.asarray(evaluator.FROZEN_PROPER_ROTATION, dtype=np.float64)
        translation = np.asarray(evaluator.FROZEN_PROPER_TRANSLATION, dtype=np.float64)
        self.target = source @ rotation.T + translation
        self.extra_scan = extra_scan
        self.mutation = mutation
        self.calls: list[tuple[tuple[int, ...], int]] = []

    def read_samples(
        self, path: Path, scan_ids: tuple[int, ...], per_scan_limit: int
    ) -> dict[str, object]:
        self.calls.append((tuple(scan_ids), per_scan_limit))
        if callable(self.mutation):
            self.mutation(path)
        ids = list(scan_ids)
        if self.extra_scan is not None:
            ids.append(self.extra_scan)
        return {
            "adapter": {"name": "synthetic-xyz-only-spy", "version": "test"},
            "scanCount": evaluator.RECEPTION_E57_SCAN_COUNT,
            "rawPointCounts": {scan_id: len(self.target) for scan_id in ids},
            "organizedSampling": {
                scan_id: {"syntheticFixture": True} for scan_id in ids
            },
            "pointsByScan": {scan_id: self.target.copy() for scan_id in ids},
        }


class EvaluatorTests(unittest.TestCase):
    def _fixture(self, root: Path, *, verify_e57_bytes: bool = False) -> tuple[object, np.ndarray]:
        model, source = _write_fixture_model(root / "inputs" / "potree")
        e57 = root / "inputs" / "e57" / "capture.e57"
        e57.parent.mkdir(parents=True)
        e57.write_bytes(b"synthetic-e57-xyz-only-source")
        transform_receipt = root / "inputs" / "receipt" / "frozen.json"
        transform_receipt.parent.mkdir(parents=True)
        _write_frozen_receipt(transform_receipt)
        output = root / "output" / "holdout.json"
        output.parent.mkdir(parents=True)
        arguments = type(
            "Arguments",
            (),
            {
                "potree_model": model,
                "e57": e57,
                "transform_receipt": transform_receipt,
                "output": output,
                "verify_e57_bytes": verify_e57_bytes,
            },
        )()
        return arguments, source

    def _run(self, arguments: object, adapter: object) -> dict[str, object]:
        return evaluator.run_evaluator(
            arguments,
            e57_adapter=adapter,
            enforce_production_pins=False,
            _test_only_allow_custom_e57_adapter=True,
        )

    def test_exact_three_scan_scope_scores_frozen_transforms_without_any_fit_call(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            arguments, source = self._fixture(Path(temporary))
            adapter = SyntheticXYZAdapter(source)
            with mock.patch.object(
                evaluator.alignment,
                "_fit_rigid_icp",
                side_effect=AssertionError("fitting is forbidden"),
            ) as fit:
                receipt = self._run(arguments, adapter)

            fit.assert_not_called()
            self.assertEqual(
                adapter.calls,
                [(evaluator.METHOD_HOLDOUT_SCAN_IDS, evaluator.E57_POINTS_PER_SCAN_LIMIT)],
            )
            self.assertEqual(
                [row["scanId"] for row in receipt["evaluation"]["perScan"]],
                list(evaluator.METHOD_HOLDOUT_SCAN_IDS),
            )
            self.assertTrue(receipt["evaluation"]["properHasLowerCombinedRawRmse"])
            self.assertTrue(
                receipt["evaluation"]["properBeatsMirrorBeyondAmbiguityTolerance"]
            )
            self.assertFalse(receipt["evaluation"]["physicalHandednessApproved"])
            self.assertFalse(receipt["evaluation"]["transformApproved"])
            self.assertFalse(
                receipt["frozenCandidates"][
                    "transformFitRefitRefinementOrOptimizationPerformed"
                ]
            )
            self.assertTrue(receipt["scope"]["methodSpecificHoldoutEvaluation"])
            self.assertFalse(receipt["scope"]["globallyPristineHoldoutAfterThisEvaluation"])
            self.assertFalse(receipt["scope"]["e57ColorRequested"])
            self.assertFalse(receipt["scope"]["e57Image2DOrPhotographRequested"])
            self.assertEqual(receipt["authority"], "none")
            self.assertEqual(
                json.loads(Path(arguments.output).read_text(encoding="utf-8")), receipt
            )

    def test_raw_adapter_extra_scan_is_rejected_before_helper_can_filter_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            arguments, source = self._fixture(Path(temporary))
            adapter = SyntheticXYZAdapter(source, extra_scan=evaluator.VALIDATION_SCAN_IDS[0])
            with self.assertRaises(evaluator.alignment.AlignmentError) as caught:
                self._run(arguments, adapter)
            self.assertEqual(caught.exception.code, "E57_ADAPTER_SCAN_SCOPE_MISMATCH")
            self.assertFalse(Path(arguments.output).exists())

    def test_changed_or_redigested_frozen_transform_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            arguments, source = self._fixture(Path(temporary))
            receipt_path = Path(arguments.transform_receipt)
            changed = _frozen_receipt_document()
            changed["proper"]["translationMeters"][0] += 0.25  # type: ignore[index]
            _write_frozen_receipt(receipt_path, changed)
            with self.assertRaises(evaluator.alignment.AlignmentError) as caught:
                self._run(arguments, SyntheticXYZAdapter(source))
            self.assertEqual(caught.exception.code, "FROZEN_TRANSFORM_RECEIPT_DIGEST_MISMATCH")

            changed.pop("payloadSha256")
            changed["payloadSha256"] = hashlib.sha256(
                evaluator.alignment._canonical_json_bytes(changed)
            ).hexdigest()
            _write_frozen_receipt(receipt_path, changed)
            with self.assertRaises(evaluator.alignment.AlignmentError) as caught:
                self._run(arguments, SyntheticXYZAdapter(source))
            self.assertEqual(caught.exception.code, "FROZEN_TRANSFORM_VALUE_MISMATCH")
            self.assertFalse(Path(arguments.output).exists())

    def test_same_size_e57_byte_mutation_with_restored_mtime_is_detected_by_full_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            arguments, source = self._fixture(Path(temporary), verify_e57_bytes=True)

            def mutate(path: Path) -> None:
                metadata = path.stat()
                payload = bytearray(path.read_bytes())
                payload[0] ^= 0x01
                path.write_bytes(payload)
                os.utime(path, ns=(metadata.st_atime_ns, metadata.st_mtime_ns))

            adapter = SyntheticXYZAdapter(source, mutation=mutate)
            with self.assertRaises(evaluator.alignment.AlignmentError) as caught:
                self._run(arguments, adapter)
            self.assertEqual(caught.exception.code, "FILE_CHANGED_DURING_RUN")
            self.assertFalse(Path(arguments.output).exists())

    def test_custom_adapter_requires_internal_test_switch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            arguments, source = self._fixture(Path(temporary))
            with self.assertRaises(evaluator.alignment.AlignmentError) as caught:
                evaluator.run_evaluator(
                    arguments,
                    e57_adapter=SyntheticXYZAdapter(source),
                    enforce_production_pins=False,
                )
            self.assertEqual(caught.exception.code, "CUSTOM_E57_ADAPTER_FORBIDDEN")

    def test_public_parser_has_no_sampling_or_fitting_tuning_controls(self) -> None:
        destinations = {action.dest for action in evaluator.build_parser()._actions}
        self.assertFalse(
            destinations
            & {
                "potree_sample_points",
                "points_per_scan",
                "maximum_iterations",
                "trim_fraction",
                "overlap_distance_m",
            }
        )


if __name__ == "__main__":
    unittest.main()
