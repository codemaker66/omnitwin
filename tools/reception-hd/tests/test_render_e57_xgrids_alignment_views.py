from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path, PurePosixPath
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "render_e57_xgrids_alignment_views.py"
SPEC = importlib.util.spec_from_file_location(
    "render_e57_xgrids_alignment_views_under_test", MODULE_PATH
)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - import machinery guard
    raise RuntimeError(f"cannot import {MODULE_PATH}")
views = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = views
SPEC.loader.exec_module(views)


T515_DOMAIN = b"OMNITWIN_RECEPTION_E57_XGRIDS_ALIGNMENT_V1\0"


def canonical(value: object) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def synthetic_t515_document() -> dict[str, object]:
    document: dict[str, object] = {
        "authority": "none",
        "schemaVersion": "omnitwin.reception.e57-xgrids-alignment-diagnostic.v1",
        "status": "diagnostic_complete_t505_blocked",
        "mode": "diagnose",
        "resultType": "not_a_transform_artifact_or_approval",
        "scope": {
            "frozenFitScanIds": list(views.FIT_SCAN_IDS),
            "frozenValidationScanIds": list(views.VALIDATION_SCAN_IDS),
            "frozenTestScanIdsNotReadOrUsed": list(views.TEST_SCAN_IDS),
            "quarantinedOrBoundaryScanIdsNotFitOrValidated": list(
                views.BOUNDARY_SCAN_IDS
            ),
        },
        "inputEvidence": {
            "e57": {"currentBytesFullyHashedThisRun": True, "sha256": "1" * 64},
            "xgridsPly": {"sha256": "2" * 64},
            "xgridsPoses": {"sha256": "3" * 64},
        },
        "diagnostic": {
            "classification": "authority_none_private_local_geometric_diagnostic",
            "diagnosticThresholdResult": {"passesAllDiagnosticChecks": False},
        },
        "t505Eligibility": {
            "eligibleForT505Completion": False,
            "eligibleForT502Training": False,
            "eligibleForRuntimeOrPublicUse": False,
        },
        "limitations": ["synthetic fixture; not evidence or an approval"],
    }
    digest = sha256(T515_DOMAIN + canonical(document))
    document["receipt"] = {
        "algorithm": "SHA-256",
        "domain": "OMNITWIN_RECEPTION_E57_XGRIDS_ALIGNMENT_V1\\0",
        "isSignature": False,
        "sha256": digest,
    }
    return document


def encode_document(document: dict[str, object]) -> bytes:
    return (
        json.dumps(
            document,
            allow_nan=False,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def asymmetric_points(np: object, count: int = 320) -> object:
    # A deterministic, non-symmetric 3-D cloud. Randomness is local and seeded.
    rng = np.random.default_rng(20260714)
    points = rng.uniform(-1.0, 1.0, size=(count, 3))
    points[:, 0] *= 3.7
    points[:, 1] *= 2.1
    points[:, 2] *= 0.9
    points[:, 0] += 0.18 * points[:, 1] ** 2
    points[:, 1] += 0.11 * points[:, 2] ** 3
    return points.astype(float)


def known_yaw_transform(np: object, source: object) -> tuple[object, object, object]:
    angle = math.radians(31.0)
    rotation = np.asarray(
        [
            [math.cos(angle), -math.sin(angle), 0.0],
            [math.sin(angle), math.cos(angle), 0.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=float,
    )
    translation = np.asarray([2.35, -1.4, 0.62], dtype=float)
    return rotation, translation, source @ rotation.T + translation


def package_arrays(np: object) -> tuple[object, dict[int, object], dict[int, object], dict[int, object]]:
    source = asymmetric_points(np)
    _, _, target = known_yaw_transform(np, source)
    fit = {scan_id: target.copy() for scan_id in views.FIT_SCAN_IDS}
    validation = {scan_id: target.copy() for scan_id in views.VALIDATION_SCAN_IDS}
    boundary = {scan_id: target.copy() for scan_id in views.BOUNDARY_SCAN_IDS}
    # Scan 122 deliberately carries geometry not present in the fit/validation sets.
    boundary[122] = target + np.asarray([0.45, -0.2, 0.0])
    return source, fit, validation, boundary


def directory_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def all_strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        result: list[str] = []
        for key, item in value.items():
            result.extend(all_strings(key))
            result.extend(all_strings(item))
        return result
    if isinstance(value, (list, tuple)):
        result = []
        for item in value:
            result.extend(all_strings(item))
        return result
    return []


class ExactT515ReceiptTests(unittest.TestCase):
    def test_production_t515_pins_are_exact(self) -> None:
        self.assertEqual(
            "c87aa8a4c96c9e86601013b41287b2019556b384fc868b206cfdb95759afdba2",
            views.EXPECTED_T515_FILE_SHA256,
        )
        self.assertEqual(
            "3f05ef356b6edaf41ed5464b9b875d2881758d4118fc6ef0533cafd03c00bd93",
            views.EXPECTED_T515_INTERNAL_SHA256,
        )

    def test_verifier_accepts_both_pins_and_rejects_each_independently(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "t515.json"
            document = synthetic_t515_document()
            payload = encode_document(document)
            internal = document["receipt"]["sha256"]
            path.write_bytes(payload)

            with mock.patch.object(
                views, "EXPECTED_T515_FILE_SHA256", sha256(payload)
            ), mock.patch.object(
                views, "EXPECTED_T515_INTERNAL_SHA256", internal
            ):
                verified = views.verify_t515_receipt(path)
                self.assertEqual("none", verified["authority"])

                # Semantically identical JSON keeps the internal canonical digest but
                # changes the exact file bytes. The whole-file pin must catch it.
                whitespace_only_change = json.dumps(
                    document, ensure_ascii=False, separators=(",", ":")
                ).encode("utf-8")
                self.assertNotEqual(payload, whitespace_only_change)
                path.write_bytes(whitespace_only_change)
                with self.assertRaises(Exception):
                    views.verify_t515_receipt(path)

            # Now pin the changed whole file, but leave the embedded receipt stale.
            # This isolates the internal self-digest check.
            stale_internal = copy.deepcopy(document)
            stale_internal["limitations"].append("unreceipted mutation")
            stale_payload = encode_document(stale_internal)
            path.write_bytes(stale_payload)
            with mock.patch.object(
                views, "EXPECTED_T515_FILE_SHA256", sha256(stale_payload)
            ), mock.patch.object(
                views, "EXPECTED_T515_INTERNAL_SHA256", internal
            ):
                with self.assertRaises(Exception):
                    views.verify_t515_receipt(path)

    def test_verifier_rejects_malformed_duplicate_key_and_nonfinite_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, payload in (
                ("malformed.json", b"{"),
                (
                    "duplicate.json",
                    b'{"authority":"none","authority":"none"}',
                ),
                ("nonfinite.json", b'{"authority":"none","value":NaN}'),
            ):
                with self.subTest(name=name):
                    path = root / name
                    path.write_bytes(payload)
                    with mock.patch.object(
                        views, "EXPECTED_T515_FILE_SHA256", sha256(payload)
                    ):
                        with self.assertRaises(Exception):
                            views.verify_t515_receipt(path)


class GravityAndBinsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            cls.np = __import__("numpy")
            cls.cKDTree = __import__("scipy.spatial", fromlist=["cKDTree"]).cKDTree
        except ImportError as error:  # pragma: no cover - environment dependent
            raise unittest.SkipTest(f"optional geometry dependencies unavailable: {error}")

    def test_fit_is_yaw_only_z_up_proper_and_fixed_unit_scale(self) -> None:
        source = asymmetric_points(self.np)
        expected_rotation, expected_translation, target = known_yaw_transform(
            self.np, source
        )
        rotation, translation, trace = views.fit_gravity_yaw(
            source,
            target,
            self.np,
            self.cKDTree,
            maximum_iterations=80,
        )

        self.np.testing.assert_allclose(rotation[2, :], [0.0, 0.0, 1.0], atol=1e-12)
        self.np.testing.assert_allclose(rotation[:, 2], [0.0, 0.0, 1.0], atol=1e-12)
        self.assertAlmostEqual(1.0, float(self.np.linalg.det(rotation)), places=10)
        self.assertEqual(1.0, trace["fixedScale"])
        self.assertTrue(trace["gravityConstrained"])
        self.assertTrue(trace["positiveZUpPreserved"])
        self.np.testing.assert_allclose(rotation, expected_rotation, atol=2e-3)
        self.np.testing.assert_allclose(translation, expected_translation, atol=5e-3)
        aligned = source @ rotation.T + translation
        self.assertLess(float(self.np.max(self.np.linalg.norm(aligned - target, axis=1))), 0.01)

    def test_fixed_bins_include_threshold_edges_and_overflow(self) -> None:
        distances = self.np.asarray(
            [0.0, 0.049999, 0.05, 0.050001, 0.1, 0.100001, 0.25, 0.250001, 999.0]
        )
        self.assertEqual(
            {
                "le_0_05_m": 3,
                "gt_0_05_le_0_10_m": 2,
                "gt_0_10_le_0_25_m": 2,
                "gt_0_25_m": 2,
            },
            views.distance_bin_counts(distances, self.np),
        )

    def test_geometry_and_bins_reject_malformed_or_nonfinite_values(self) -> None:
        valid = asymmetric_points(self.np, 40)
        _, _, target = known_yaw_transform(self.np, valid)
        cases = (
            (self.np.zeros((4, 2)), target),
            (self.np.empty((0, 3)), target),
            (valid, target[:2]),
            (valid.copy(), target),
            (valid, target.copy()),
        )
        cases[3][0][3, 1] = self.np.nan
        cases[4][1][4, 2] = self.np.inf
        for source, destination in cases:
            with self.subTest(shape=(source.shape, destination.shape)):
                with self.assertRaises(Exception):
                    views.fit_gravity_yaw(
                        source,
                        destination,
                        self.np,
                        self.cKDTree,
                        maximum_iterations=4,
                    )

        for distances in (
            self.np.asarray([-0.001]),
            self.np.asarray([self.np.nan]),
            self.np.asarray([self.np.inf]),
            self.np.asarray([[0.01, 0.02]]),
        ):
            with self.subTest(distances=distances):
                with self.assertRaises(Exception):
                    views.distance_bin_counts(distances, self.np)

    def test_symmetric_xy_geometry_is_marked_yaw_ambiguous(self) -> None:
        angles = self.np.linspace(0.0, 2.0 * math.pi, 128, endpoint=False)
        source = self.np.column_stack(
            (self.np.cos(angles), self.np.sin(angles), 0.2 * self.np.sin(2.0 * angles))
        )
        target = self.np.concatenate((source, source), axis=0)
        _, _, trace = views.fit_gravity_yaw(
            source, target, self.np, self.cKDTree, maximum_iterations=8
        )
        self.assertFalse(trace["yawFamilyUnambiguous"])
        self.assertIn("runnerUpYawFamilyTrimmed95RmseMeters", trace)

    def test_dependency_version_is_plain_and_injected_adapter_is_not_production(self) -> None:
        version = views._plain_package_version("pye57")
        self.assertNotIn(":\\", version)
        self.assertNotIn("/", version)
        with self.assertRaises(Exception):
            views._real_build(SimpleNamespace(), e57_adapter=object())

    def test_metre_axis_labels_thin_out_on_wide_views(self) -> None:
        self.assertEqual(1, views._metre_label_interval(-2.0, 12.0, 1_000))
        self.assertEqual(10, views._metre_label_interval(-30.0, 55.0, 500))
        self.assertEqual(20, views._metre_label_interval(-30.0, 55.0, 260))
        for invalid in ((1.0, 1.0, 500), (2.0, 1.0, 500), (0.0, 1.0, 1)):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    views._metre_label_interval(*invalid)

    def test_alignment_helper_is_checked_before_import(self) -> None:
        with self.assertRaises(Exception):
            views._load_alignment_module("0" * 64, 1)


class AtomicPackageWriterTests(unittest.TestCase):
    def test_partial_failure_is_cleaned_and_final_directory_never_appears(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            output = parent / "package"

            def fail_halfway(target: object, payload: bytes) -> None:
                target.write(payload[: max(1, len(payload) // 2)])
                raise OSError("injected write failure")

            with self.assertRaises(Exception):
                views._write_package_create_only(
                    output,
                    {"manifest.json": b"{}", "views/top.png": b"png"},
                    _write_hook=fail_halfway,
                )
            self.assertFalse(output.exists())
            self.assertEqual([], list(parent.iterdir()))

    def test_preexisting_destination_and_race_winner_are_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            output = parent / "package"
            output.mkdir()
            sentinel = output / "owner.txt"
            sentinel.write_text("pre-existing owner", encoding="utf-8")
            with self.assertRaises(Exception):
                views._write_package_create_only(output, {"manifest.json": b"{}"})
            self.assertEqual("pre-existing owner", sentinel.read_text(encoding="utf-8"))
            self.assertEqual(["package"], [path.name for path in parent.iterdir()])

        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            output = parent / "package"

            def create_race_winner(target: object, payload: bytes) -> None:
                target.write(payload)
                if not output.exists():
                    output.mkdir()
                    (output / "owner.txt").write_text("race winner", encoding="utf-8")

            with self.assertRaises(Exception):
                views._write_package_create_only(
                    output,
                    {"manifest.json": b"{}", "views/top.png": b"png"},
                    _write_hook=create_race_winner,
                )
            self.assertEqual(
                "race winner", (output / "owner.txt").read_text(encoding="utf-8")
            )
            self.assertEqual(["package"], [path.name for path in parent.iterdir()])

    def test_writer_rejects_absolute_and_traversal_member_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            for index, member in enumerate(("../escape", "/absolute", "C:/absolute")):
                output = parent / f"package-{index}"
                with self.subTest(member=member), self.assertRaises(Exception):
                    views._write_package_create_only(output, {member: b"unsafe"})
                self.assertFalse(output.exists())
            self.assertFalse((parent / "escape").exists())


class PackageIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            cls.np = __import__("numpy")
            cls.cKDTree = __import__("scipy.spatial", fromlist=["cKDTree"]).cKDTree
        except ImportError as error:  # pragma: no cover - environment dependent
            raise unittest.SkipTest(f"optional geometry dependencies unavailable: {error}")

    def build_with_arrays(
        self,
        output: Path,
        source: object,
        fit: dict[int, object],
        validation: dict[int, object],
        boundary: dict[int, object],
    ) -> dict[str, object]:
        t515 = synthetic_t515_document()
        with mock.patch.object(
            views, "EXPECTED_T515_INTERNAL_SHA256", t515["receipt"]["sha256"]
        ):
            return views.build_package_from_arrays(
                source,
                fit,
                validation,
                boundary,
                t515,
                output,
                self.np,
                self.cKDTree,
            )

    def build(self, output: Path) -> dict[str, object]:
        source, fit, validation, boundary = package_arrays(self.np)
        return self.build_with_arrays(output, source, fit, validation, boundary)

    def test_scan_roles_never_read_test_and_keep_122_unscored_boundary_only(self) -> None:
        self.assertEqual((126, 129, 141), tuple(views.TEST_SCAN_IDS))
        self.assertEqual((122, 123, 140), tuple(views.BOUNDARY_SCAN_IDS))
        self.assertFalse(
            set(views.TEST_SCAN_IDS)
            & (set(views.FIT_SCAN_IDS) | set(views.VALIDATION_SCAN_IDS) | set(views.BOUNDARY_SCAN_IDS))
        )
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "package"
            manifest = self.build(output)
            scope = manifest["scope"]
            self.assertEqual(list(views.FIT_SCAN_IDS), scope["fitScanIds"])
            self.assertEqual(list(views.VALIDATION_SCAN_IDS), scope["validationScanIds"])
            self.assertEqual(
                list(views.TEST_SCAN_IDS),
                scope["testScanIdsGeometryNotDecodedSampledRenderedFitOrScored"],
            )
            self.assertEqual(
                list(views.BOUNDARY_SCAN_IDS), scope["boundaryScanIdsNotFitOrScored"]
            )
            self.assertNotIn(122, scope["fitScanIds"])
            self.assertNotIn(122, scope["validationScanIds"])
            self.assertNotIn(122, scope["scoredScanIds"])
            self.assertNotIn(126, scope["requestedScanIds"])
            self.assertNotIn(129, scope["requestedScanIds"])
            self.assertNotIn(141, scope["requestedScanIds"])

    def test_package_and_png_bytes_are_deterministic_and_paths_are_relative(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "first"
            second = root / "second"
            first_manifest = self.build(first)
            second_manifest = self.build(second)
            self.assertEqual(first_manifest, second_manifest)
            self.assertEqual(directory_bytes(first), directory_bytes(second))
            payloads = directory_bytes(first)
            self.assertIn("manifest.json", payloads)
            self.assertTrue(any(name.endswith(".png") for name in payloads))

            entries = first_manifest["files"]
            self.assertGreater(len(entries), 0)
            for entry in entries:
                relative = entry["path"]
                parsed = PurePosixPath(relative)
                self.assertFalse(parsed.is_absolute())
                self.assertNotIn("..", parsed.parts)
                self.assertNotIn("\\", relative)
                self.assertIn(relative, payloads)
                self.assertEqual(len(payloads[relative]), entry["sizeBytes"])
                self.assertEqual(sha256(payloads[relative]), entry["sha256"])
            serialized = json.dumps(first_manifest, sort_keys=True)
            self.assertNotIn(str(first), serialized)
            self.assertNotIn(str(second), serialized)
            self.assertFalse(any(value.startswith("/") for value in all_strings(entries)))

    def test_package_is_permanently_authority_none_and_t505_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest = self.build(Path(directory) / "package")
            self.assertEqual("none", manifest["authority"])
            self.assertEqual(
                "private_visual_diagnostic_t505_blocked", manifest["status"]
            )
            eligibility = manifest["t505Eligibility"]
            self.assertFalse(eligibility["eligibleForT505Completion"])
            self.assertFalse(eligibility["eligibleForT502Training"])
            self.assertFalse(eligibility["eligibleForRuntimeOrPublicUse"])
            words = " ".join(all_strings(manifest)).lower()
            self.assertIn("authority", words)
            self.assertIn("t-505", words)
            self.assertIn("blocked", words)
            self.assertIn("gaussian centres", words)
            self.assertIn("not surveyed surfaces", words)
            self.assertEqual(
                "synthetic_or_injected_arrays_not_real_evidence",
                manifest["evidencePosture"],
            )

    def test_manifest_records_exact_views_bounds_palette_and_both_directions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest = self.build(Path(directory) / "package")
            required = {
                "views/full-context-top.png",
                "views/crop-top.png",
                "views/crop-side-xz.png",
                "views/crop-side-yz.png",
                "views/crop-oblique.png",
                "views/distance-xgrids-to-e57.png",
                "views/distance-e57-to-xgrids.png",
                "views/candidate-comparison.png",
            }
            self.assertEqual(required, {entry["path"] for entry in manifest["files"]})
            self.assertEqual(required, set(manifest["viewPolicy"]["views"]))
            for specification in manifest["viewPolicy"]["views"].values():
                bounds = specification.get("boundsMeters", specification.get("boundsMetersEachPanel"))
                self.assertEqual(4, len(bounds))
            palette = manifest["viewPolicy"]["fixedRgbPalette"]
            self.assertIn("distanceLe5cm", palette)
            self.assertIn("distanceGt25cmOverflow", palette)
            runtime = manifest["viewPolicy"]["renderingRuntime"]
            self.assertTrue(runtime["pillowVersion"])
            self.assertFalse(runtime["crossMachineByteIdentityClaimed"])
            self.assertNotIn(":\\", json.dumps(runtime, sort_keys=True))
            for metrics in manifest["candidateMetricsOnIdenticalValidationSamples"].values():
                full = metrics["fullValidation"]
                self.assertIn("xgridsGaussianCentresToE57LaserGeometry", full)
                self.assertIn("e57LaserGeometryToXgridsGaussianCentres", full)

    def test_resealed_semantic_change_and_missing_required_view_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            semantic_package = root / "semantic"
            self.build(semantic_package)
            path = semantic_package / "manifest.json"
            document = json.loads(path.read_text(encoding="utf-8"))
            document["scope"]["scoredScanIds"] = []
            document.pop("manifestReceipt")
            views._seal_manifest(document)
            path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            with self.assertRaises(Exception):
                views.verify_package(semantic_package)

            view_package = root / "missing-view"
            self.build(view_package)
            path = view_package / "manifest.json"
            document = json.loads(path.read_text(encoding="utf-8"))
            document["files"] = [
                entry for entry in document["files"] if entry["path"] != "views/crop-oblique.png"
            ]
            document.pop("manifestReceipt")
            views._seal_manifest(document)
            path.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            with self.assertRaises(Exception):
                views.verify_package(view_package)

    def test_verifier_detects_file_and_manifest_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file_package = root / "file-tamper"
            self.build(file_package)
            verified = views.verify_package(file_package)
            self.assertEqual("none", verified["authority"])
            image = next(file_package.rglob("*.png"))
            payload = bytearray(image.read_bytes())
            payload[len(payload) // 2] ^= 1
            image.write_bytes(payload)
            with self.assertRaises(Exception):
                views.verify_package(file_package)

            manifest_package = root / "manifest-tamper"
            self.build(manifest_package)
            manifest_path = manifest_package / "manifest.json"
            document = json.loads(manifest_path.read_text(encoding="utf-8"))
            document["authority"] = "invented-approval"
            manifest_path.write_text(
                json.dumps(document, separators=(",", ":")), encoding="utf-8"
            )
            with self.assertRaises(Exception):
                views.verify_package(manifest_package)

    def test_build_is_create_only_and_rejects_nonfinite_or_mislabeled_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            occupied = root / "occupied"
            occupied.mkdir()
            sentinel = occupied / "owner.txt"
            sentinel.write_text("keep", encoding="utf-8")
            with self.assertRaises(Exception):
                self.build(occupied)
            self.assertEqual("keep", sentinel.read_text(encoding="utf-8"))

            source, fit, validation, boundary = package_arrays(self.np)
            source[5, 0] = self.np.nan
            nonfinite = root / "nonfinite"
            with self.assertRaises(Exception):
                self.build_with_arrays(
                    nonfinite, source, fit, validation, boundary
                )
            self.assertFalse(nonfinite.exists())

            source, fit, validation, boundary = package_arrays(self.np)
            fit[126] = source.copy()
            mislabeled = root / "heldout-leak"
            with self.assertRaises(Exception):
                self.build_with_arrays(
                    mislabeled, source, fit, validation, boundary
                )
            self.assertFalse(mislabeled.exists())


if __name__ == "__main__":
    unittest.main()
