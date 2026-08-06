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

import align_e57_xgrids as alignment  # noqa: E402
import register_potree_e57 as diagnostic  # noqa: E402


def fixture_records(count: int = 80) -> tuple[bytes, np.ndarray, list[int], list[int]]:
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
    scale = np.asarray([0.001, 0.001, 0.001], dtype=np.float64)
    offset = np.asarray([-2.0, -3.0, -1.0], dtype=np.float64)
    return payload, raw.astype(np.float64) * scale + offset, intensity, prediction


def fixture_metadata(points: np.ndarray, intensity: list[int], prediction: list[int]) -> dict[str, object]:
    count = int(points.shape[0])
    return {
        "version": "2.0",
        "name": "potree",
        "description": "unit fixture",
        "points": count,
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
                "min": [float(item) for item in np.min(points, axis=0)],
                "max": [float(item) for item in np.max(points, axis=0)],
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


def write_fixture_model(root: Path) -> tuple[Path, np.ndarray]:
    model = root / "model"
    model.mkdir(parents=True)
    octree, points, intensity, prediction = fixture_records()
    metadata = fixture_metadata(points, intensity, prediction)
    (model / "metadata.json").write_text(
        json.dumps(metadata, separators=(",", ":")), encoding="utf-8"
    )
    (model / "octree.bin").write_bytes(octree)
    (model / "hierarchy.bin").write_bytes(
        struct.pack("<BBIQQ", 1, 0, len(points), 0, len(octree))
    )
    return model, points


def read_metadata(model: Path) -> dict[str, object]:
    return json.loads((model / "metadata.json").read_text(encoding="utf-8"))


def write_metadata(model: Path, value: dict[str, object]) -> None:
    (model / "metadata.json").write_text(
        json.dumps(value, separators=(",", ":")), encoding="utf-8"
    )


class SyntheticE57Adapter:
    def __init__(self, source: np.ndarray, *, mirrored: bool) -> None:
        self.requested: tuple[int, ...] | None = None
        if mirrored:
            rotation = np.diag([-1.0, 1.0, 1.0])
        else:
            rotation = np.eye(3, dtype=np.float64)
        translation = np.asarray([4.3, -1.7, 2.2], dtype=np.float64)
        self.target = source @ rotation.T + translation

    def read_samples(
        self, _path: Path, scan_ids: tuple[int, ...], _per_scan_limit: int
    ) -> dict[str, object]:
        self.requested = tuple(scan_ids)
        return {
            "adapter": {"name": "synthetic-firewall-spy", "version": "test"},
            "scanCount": 149,
            "rawPointCounts": {scan_id: len(self.target) for scan_id in scan_ids},
            "organizedSampling": {},
            "pointsByScan": {scan_id: self.target.copy() for scan_id in scan_ids},
        }


class ExtraScanE57Adapter(SyntheticE57Adapter):
    def read_samples(
        self, path: Path, scan_ids: tuple[int, ...], per_scan_limit: int
    ) -> dict[str, object]:
        result = super().read_samples(path, scan_ids, per_scan_limit)
        points = result["pointsByScan"]
        assert isinstance(points, dict)
        points[diagnostic.FROZEN_TEST_SCAN_IDS[0]] = self.target.copy()
        return result


class PotreeDecoderTests(unittest.TestCase):
    def test_valid_fixture_decodes_every_record_and_binds_all_three_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model, expected = write_fixture_model(Path(temporary))
            bundle = diagnostic.load_potree_model(
                model,
                sample_limit=len(expected),
                np=np,
                enforce_production_pins=False,
            )
            np.testing.assert_allclose(bundle.sampled_points, expected, atol=1e-12)
            self.assertEqual(bundle.evidence["decoderValidation"]["decodedPointCount"], len(expected))
            self.assertTrue(bundle.evidence["decoderValidation"]["everyRecordDecodedAndValidated"])
            self.assertEqual(
                set(bundle.evidence["files"]),
                {"metadata.json", "octree.bin", "hierarchy.bin"},
            )
            self.assertTrue(all(row["fullyHashedThisRun"] for row in bundle.evidence["files"].values()))
            self.assertTrue(bundle.evidence["hierarchyValidation"]["byteRangesAreDisjointAndGapless"])

    def test_metadata_rejects_unknown_keys_extra_attributes_and_wrong_order(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model, _ = write_fixture_model(Path(temporary))
            original = read_metadata(model)
            cases: list[dict[str, object]] = []

            unknown = copy.deepcopy(original)
            unknown["surprise"] = True
            cases.append(unknown)

            extra_attribute = copy.deepcopy(original)
            extra_attribute["attributes"].append(copy.deepcopy(extra_attribute["attributes"][1]))  # type: ignore[union-attr,index]
            cases.append(extra_attribute)

            wrong_order = copy.deepcopy(original)
            wrong_order["attributes"][0], wrong_order["attributes"][1] = (  # type: ignore[index]
                wrong_order["attributes"][1],
                wrong_order["attributes"][0],
            )
            cases.append(wrong_order)

            extra_attribute_key = copy.deepcopy(original)
            extra_attribute_key["attributes"][0]["red"] = 1  # type: ignore[index]
            cases.append(extra_attribute_key)

            for metadata in cases:
                with self.subTest(case=cases.index(metadata)):
                    payload = json.dumps(metadata, separators=(",", ":")).encode("utf-8")
                    with self.assertRaises(alignment.AlignmentError):
                        diagnostic._parse_metadata(payload)

    def test_nonfinite_and_overflowing_metadata_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model, _ = write_fixture_model(Path(temporary))
            metadata = read_metadata(model)
            nonfinite = json.dumps(metadata, separators=(",", ":")).replace(
                '"spacing":0.125', '"spacing":1e9999'
            )
            with self.assertRaises(alignment.AlignmentError) as raised:
                diagnostic._parse_metadata(nonfinite.encode("utf-8"))
            self.assertEqual(raised.exception.code, "NONFINITE_METADATA")

            overflow = copy.deepcopy(metadata)
            overflow["offset"] = [1_000_000_000.0, -3.0, -1.0]
            overflow["boundingBox"]["min"] = [1_000_000_000.0, -3.0, -1.0]  # type: ignore[index]
            overflow["boundingBox"]["max"] = [1_000_000_001.0, 0.0, 2.0]  # type: ignore[index]
            with self.assertRaises(alignment.AlignmentError) as raised:
                diagnostic._parse_metadata(json.dumps(overflow).encode("utf-8"))
            self.assertEqual(raised.exception.code, "COORDINATE_OVERFLOW_RISK")

    def test_octree_length_and_hierarchy_ranges_must_match_exactly(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, expected = write_fixture_model(root)
            octree = model / "octree.bin"
            octree.write_bytes(octree.read_bytes()[:-1])
            with self.assertRaises(alignment.AlignmentError) as raised:
                diagnostic.load_potree_model(
                    model, sample_limit=len(expected), np=np, enforce_production_pins=False
                )
            self.assertEqual(raised.exception.code, "OCTREE_LENGTH_MISMATCH")

            model2, expected2 = write_fixture_model(root / "second")
            size = (model2 / "octree.bin").stat().st_size
            (model2 / "hierarchy.bin").write_bytes(
                struct.pack("<BBIQQ", 1, 0, len(expected2), 1, size)
            )
            with self.assertRaises(alignment.AlignmentError) as raised:
                diagnostic.load_potree_model(
                    model2, sample_limit=len(expected2), np=np, enforce_production_pins=False
                )
            self.assertEqual(raised.exception.code, "HIERARCHY_RANGE_OUT_OF_BOUNDS")

    def test_symlinked_model_member_is_rejected_when_platform_allows_links(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, expected = write_fixture_model(root)
            real_metadata = root / "real-metadata.json"
            (model / "metadata.json").replace(real_metadata)
            try:
                os.symlink(real_metadata, model / "metadata.json")
            except OSError as error:
                self.skipTest(f"symlink creation unavailable: {error}")
            with self.assertRaises(alignment.AlignmentError) as raised:
                diagnostic.load_potree_model(
                    model, sample_limit=len(expected), np=np, enforce_production_pins=False
                )
            self.assertEqual(raised.exception.code, "UNSAFE_LINK")

    def test_production_pin_size_is_rejected_before_any_member_payload_read(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model, _ = write_fixture_model(Path(temporary))
            fixture_pins: dict[str, dict[str, object]] = {}
            for name in diagnostic.POTREE_FILE_PINS:
                path = model / name
                fixture_pins[name] = {
                    "sizeBytes": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                }
            octree = model / "octree.bin"
            octree.write_bytes(octree.read_bytes() + b"x")

            with (
                mock.patch.object(diagnostic, "POTREE_FILE_PINS", fixture_pins),
                mock.patch.object(
                    alignment,
                    "_read_bound_bytes",
                    wraps=alignment._read_bound_bytes,
                ) as read_bound,
                self.assertRaises(alignment.AlignmentError) as raised,
            ):
                diagnostic.load_potree_model(
                    model,
                    sample_limit=80,
                    np=np,
                    enforce_production_pins=True,
                )

            self.assertEqual(raised.exception.code, "POTREE_PIN_SIZE_MISMATCH")
            read_bound.assert_not_called()


class DiagnosticTests(unittest.TestCase):
    def _arguments(self, model: Path, e57: Path, output: Path) -> object:
        return type(
            "Arguments",
            (),
            {
                "potree_model": model,
                "e57": e57,
                "output": output,
                "potree_sample_points": 80,
                "points_per_scan": 80,
                "maximum_iterations": 4,
                "trim_fraction": 0.8,
                "overlap_distance_m": 0.20,
                "verify_e57_bytes": False,
            },
        )()

    def test_scan_firewall_mirror_better_and_e57_binding_are_reported_honestly(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, source = write_fixture_model(root / "input" / "potree")
            e57 = root / "input" / "e57" / "capture.e57"
            e57.parent.mkdir(parents=True)
            e57_payload = b"synthetic-read-only-e57"
            e57.write_bytes(e57_payload)
            output = root / "output" / "diagnostic.json"
            output.parent.mkdir()
            adapter = SyntheticE57Adapter(source, mirrored=True)
            arguments = self._arguments(model, e57, output)

            with (
                mock.patch.object(diagnostic, "RECEPTION_E57_SIZE_BYTES", len(e57_payload)),
                mock.patch.object(alignment, "RECEPTION_E57_SIZE_BYTES", len(e57_payload)),
            ):
                receipt = diagnostic.run_diagnostic(
                    arguments,
                    e57_adapter=adapter,
                    enforce_production_pins=False,
                    _test_only_allow_custom_e57_adapter=True,
                )

            self.assertEqual(adapter.requested, diagnostic.REQUESTED_SCAN_IDS)
            self.assertFalse(set(adapter.requested or ()) & diagnostic.FORBIDDEN_SCAN_IDS)
            self.assertEqual(
                receipt["diagnostic"]["heldValidationComparison"]["samplePreference"],
                "mirror_lower_validation_rmse_geometry_ambiguous",
            )
            self.assertLess(
                receipt["diagnostic"]["improperMirrorCompetitor"]["heldValidationMetrics"]
                ["combinedStatisticsMeters"]["rmse"],
                receipt["diagnostic"]["properCandidate"]["heldValidationMetrics"]
                ["combinedStatisticsMeters"]["rmse"],
            )
            self.assertFalse(receipt["diagnostic"]["improperMirrorCompetitor"]["isPermittedTransformCandidate"])
            self.assertFalse(receipt["eligibility"]["eligibleForTransformRegistration"])
            e57_evidence = receipt["inputEvidence"]["e57"]
            self.assertFalse(e57_evidence["currentBytesFullyHashedThisRun"])
            self.assertIsNone(e57_evidence["currentFullSha256"])
            self.assertFalse(e57_evidence["frozenExpectedSha256ComparedToCurrentBytes"])
            self.assertIn("not a full-content hash", e57_evidence["bindingWithoutFullHash"])
            self.assertEqual(receipt["authority"], "none")
            self.assertEqual(
                receipt["status"],
                "diagnostic_complete_test_adapter_unusable_authority_none",
            )
            self.assertEqual(receipt["resultType"], "test_adapter_result_unusable_as_evidence")
            self.assertIsNone(receipt["safety"]["trainingPerformed"])
            self.assertIsNone(receipt["safety"]["networkOrProviderUsePerformed"])
            self.assertFalse(receipt["safety"]["customAdapterSideEffectsEstablished"])
            self.assertFalse(receipt["eligibility"]["eligibleForEvidenceUse"])
            self.assertEqual(
                receipt["scope"]["customAdapterReadOrUseOfUnrequestedScans"],
                "unestablished",
            )
            self.assertNotIn("frozenTestScanIdsNotRequestedReadOrUsed", receipt["scope"])
            proper_transform = receipt["diagnostic"]["properCandidate"]["transform"]
            mirror_transform = receipt["diagnostic"]["improperMirrorCompetitor"]["transform"]
            self.assertEqual(proper_transform["rotationAngleApplicability"], "proper_SO3_rotation")
            self.assertIsNotNone(proper_transform["rotationAngleDegrees"])
            self.assertEqual(
                mirror_transform["rotationAngleApplicability"],
                "not_applicable_improper_orthogonal_transform",
            )
            self.assertIsNone(mirror_transform["rotationAngleDegrees"])
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), receipt)

    def test_custom_adapter_is_fail_closed_without_internal_test_only_switch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, source = write_fixture_model(root / "input" / "potree")
            e57 = root / "input" / "capture.e57"
            e57.write_bytes(b"synthetic-read-only-e57")
            output = root / "receipt.json"
            arguments = self._arguments(model, e57, output)

            with self.assertRaises(alignment.AlignmentError) as raised:
                diagnostic.run_diagnostic(
                    arguments,
                    e57_adapter=SyntheticE57Adapter(source, mirrored=False),
                    enforce_production_pins=False,
                )

            self.assertEqual(raised.exception.code, "CUSTOM_E57_ADAPTER_FORBIDDEN")
            self.assertFalse(output.exists())

    def test_raw_adapter_extra_scan_is_rejected_before_helper_filtering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, source = write_fixture_model(root / "input" / "potree")
            e57 = root / "input" / "e57" / "capture.e57"
            e57.parent.mkdir(parents=True)
            e57_payload = b"synthetic-read-only-e57"
            e57.write_bytes(e57_payload)
            output = root / "output" / "diagnostic.json"
            output.parent.mkdir()
            arguments = self._arguments(model, e57, output)

            with (
                mock.patch.object(diagnostic, "RECEPTION_E57_SIZE_BYTES", len(e57_payload)),
                mock.patch.object(alignment, "RECEPTION_E57_SIZE_BYTES", len(e57_payload)),
                self.assertRaises(alignment.AlignmentError) as raised,
            ):
                diagnostic.run_diagnostic(
                    arguments,
                    e57_adapter=ExtraScanE57Adapter(source, mirrored=False),
                    enforce_production_pins=False,
                    _test_only_allow_custom_e57_adapter=True,
                )

            self.assertEqual(raised.exception.code, "E57_ADAPTER_SCAN_SCOPE_MISMATCH")
            self.assertFalse(output.exists())

    def test_mirror_angle_is_not_reported_as_an_so3_rotation(self) -> None:
        proper = diagnostic._transform_evidence(
            np.eye(3), np.zeros(3), np, determinant_sign=1
        )
        mirror = diagnostic._transform_evidence(
            np.diag([-1.0, 1.0, 1.0]),
            np.zeros(3),
            np,
            determinant_sign=-1,
        )
        self.assertEqual(proper["rotationAngleDegrees"], 0.0)
        self.assertEqual(proper["rotationAngleApplicability"], "proper_SO3_rotation")
        self.assertIsNone(mirror["rotationAngleDegrees"])
        self.assertEqual(
            mirror["rotationAngleApplicability"],
            "not_applicable_improper_orthogonal_transform",
        )

    def test_near_equal_mirror_scores_stay_ambiguous_inside_conservative_band(self) -> None:
        def metrics(rmse: float) -> dict[str, object]:
            return {"combinedStatisticsMeters": {"rmse": rmse}}

        near_tie = diagnostic._metric_comparison(metrics(0.2000), metrics(0.2005))
        self.assertEqual(
            near_tie["samplePreference"],
            "validation_rmse_within_tolerance_geometry_ambiguous",
        )
        self.assertFalse(near_tie["differenceExceedsAmbiguityTolerance"])
        self.assertGreaterEqual(near_tie["ambiguityToleranceMeters"], 0.001)

        clear_proper = diagnostic._metric_comparison(metrics(0.200), metrics(0.210))
        self.assertEqual(clear_proper["samplePreference"], "proper_lower_validation_rmse")
        self.assertTrue(clear_proper["differenceExceedsAmbiguityTolerance"])

        clear_mirror = diagnostic._metric_comparison(metrics(0.210), metrics(0.200))
        self.assertEqual(
            clear_mirror["samplePreference"],
            "mirror_lower_validation_rmse_geometry_ambiguous",
        )
        self.assertTrue(clear_mirror["differenceExceedsAmbiguityTolerance"])

    def test_receipt_sealing_is_deterministic_and_domain_separated(self) -> None:
        document = {"schemaVersion": "fixture", "authority": "none", "nested": {"b": 2, "a": 1}}
        first = diagnostic._seal_receipt(document)
        second = diagnostic._seal_receipt(copy.deepcopy(document))
        self.assertEqual(first, second)
        self.assertNotIn("receipt", document)
        unsigned = copy.deepcopy(first)
        seal = unsigned.pop("receipt")
        expected = hashlib.sha256(
            diagnostic.RECEIPT_DIGEST_DOMAIN + alignment._canonical_json_bytes(unsigned)
        ).hexdigest()
        self.assertEqual(seal["sha256"], expected)
        self.assertFalse(seal["isSignature"])

    def test_publication_is_create_only_atomic_and_preserves_race_winner(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "receipt.json"
            output.write_bytes(b"first")
            with self.assertRaises(alignment.AlignmentError) as raised:
                diagnostic._publish_receipt(output, {"authority": "none"}, (), ())
            self.assertEqual(raised.exception.code, "OUTPUT_EXISTS")
            self.assertEqual(output.read_bytes(), b"first")

            race_output = root / "race.json"

            def create_race_winner(target: object, payload: bytes) -> None:
                target.write(payload)  # type: ignore[attr-defined]
                race_output.write_bytes(b"race-winner")

            with self.assertRaises(alignment.AlignmentError) as raised:
                diagnostic._publish_receipt(
                    race_output,
                    {"authority": "none"},
                    (),
                    (),
                    _write_hook=create_race_winner,
                )
            self.assertEqual(raised.exception.code, "OUTPUT_EXISTS")
            self.assertEqual(race_output.read_bytes(), b"race-winner")
            leftovers = list(root.glob(".race.json.*.private-tmp"))
            self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
