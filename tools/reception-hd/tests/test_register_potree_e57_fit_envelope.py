from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path
from types import SimpleNamespace
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
import register_potree_e57_fit_envelope as fit_envelope  # noqa: E402


REVIEW_DIGEST_DOMAIN = b"OMNITWIN_FOUNDRY_ROOM_ENVELOPE_REVIEW_V0\x00"
# Domain-separated digest of the deterministic fixture's empty root and exact
# metadata/hierarchy/octree member identities.
FIXTURE_BUNDLE_SHA256 = "4d4ec26e64e4919e39368e82d9ab3e6f9318de50540838f8443d21a9983a0f4e"
PREVIEW_VIEW_SPECS = (
    ("position_0_1", (0, 1), 2),
    ("position_0_2", (0, 2), 1),
    ("position_1_2", (1, 2), 0),
)
REVIEW_LIMITATIONS = [
    (
        "OPERATOR_SELECTION_DOES_NOT_ESTABLISH_UNITS_AXES_FRAME_CRS_ROOM_IDENTITY_"
        "OR_PHYSICAL_ACCURACY"
    ),
    (
        "THE_POLYGON_IS_A_FIT_SEED_ONLY_AND_IS_NOT_VALIDATION_INDEPENDENT_CONTROL_"
        "OR_TRANSFORM_AUTHORITY"
    ),
    (
        "PIXEL_TO_DECODER_INVERSION_USES_THE_FROZEN_V8_DIAGNOSTIC_RASTER_MAPPING_"
        "AND_DOES_NOT_ADD_SOURCE_PRECISION"
    ),
    "PURPOSE_SCOPED_RIGHTS_AND PRODUCER_LINEAGE_REMAIN_UNREVIEWED",
]


def fixture_records(count: int = 640) -> tuple[bytes, np.ndarray, list[int], list[int]]:
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
    intensity = [1 + index % 250 for index in range(count)]
    prediction = [(20 + index) % 256 for index in range(count)]
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


def fixture_metadata(
    points: np.ndarray, intensity: list[int], prediction: list[int]
) -> dict[str, object]:
    count = int(points.shape[0])
    return {
        "version": "2.0",
        "name": "potree",
        "description": "fit-only envelope fixture",
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


def fixture_member_rows(model: Path) -> list[dict[str, object]]:
    roles = (
        ("metadata", "metadata.json"),
        ("hierarchy", "hierarchy.bin"),
        ("octree", "octree.bin"),
    )
    return [
        {
            "role": role,
            "relativePath": relative_path,
            "sizeBytes": (model / relative_path).stat().st_size,
            "sha256": hashlib.sha256((model / relative_path).read_bytes()).hexdigest(),
        }
        for role, relative_path in roles
    ]


def preview_row(view_id: str, axes: tuple[int, int], omitted_axis: int) -> dict[str, object]:
    return {
        "viewId": view_id,
        "mode": "record_density",
        "fileName": f"potree-v2-{view_id}-record_density.png",
        "sha256": hashlib.sha256(f"preview-file:{view_id}".encode("ascii")).hexdigest(),
        "pixelSha256": hashlib.sha256(
            f"preview-pixels:{view_id}".encode("ascii")
        ).hexdigest(),
        "width": 1024,
        "height": 1024,
        "projectedAxes": list(axes),
        "omittedAxis": omitted_axis,
    }


def js_rounded(value: float) -> float:
    return math.floor(value * 1_000_000_000_000 + 0.5) / 1_000_000_000_000


def uniform_mapping(points: np.ndarray, *, margin_pixels: int = 32) -> dict[str, object]:
    decoded_min = np.min(points, axis=0)
    decoded_max = np.max(points, axis=0)
    width = 1024
    height = 1024
    available_pixels = width - 2 * margin_pixels
    span_x = float(decoded_max[0] - decoded_min[0])
    span_y = float(decoded_max[1] - decoded_min[1])
    scale_candidates = [
        available_pixels / span for span in (span_x, span_y) if span > 0
    ]
    fit_scale = min(scale_candidates) if scale_candidates else 1.0
    offset_x = (width - span_x * fit_scale) / 2.0
    offset_y = (height - span_y * fit_scale) / 2.0
    return {
        "profile": "potree_v2_v8_intrinsic_pixel_to_decoder_coordinates_v0",
        "decodedMin": [js_rounded(float(value)) for value in decoded_min],
        "decodedMax": [js_rounded(float(value)) for value in decoded_max],
        "width": width,
        "height": height,
        "marginPixels": margin_pixels,
        "fitScale": js_rounded(fit_scale),
        "offsetX": js_rounded(offset_x),
        "offsetY": js_rounded(offset_y),
        "yAxisRule": "raw_y_floor_then_height_minus_one",
    }


def intrinsic_to_decoder(
    polygon: list[list[int]], mapping: dict[str, object]
) -> list[list[float]]:
    scale = float(mapping["fitScale"])
    offset_x = float(mapping["offsetX"])
    offset_y = float(mapping["offsetY"])
    height = int(mapping["height"])
    decoded_min = mapping["decodedMin"]
    assert isinstance(decoded_min, list)
    return [
        [
            js_rounded(float(decoded_min[0]) + (point[0] - offset_x) / scale),
            js_rounded(
                float(decoded_min[1])
                + (height - 1 - point[1] - offset_y) / scale
            ),
        ]
        for point in polygon
    ]


def decoder_point_to_intrinsic(
    point: np.ndarray, mapping: dict[str, object]
) -> list[int]:
    scale = float(mapping["fitScale"])
    offset_x = float(mapping["offsetX"])
    offset_y = float(mapping["offsetY"])
    width = int(mapping["width"])
    height = int(mapping["height"])
    decoded_min = mapping["decodedMin"]
    assert isinstance(decoded_min, list)
    x = math.floor(offset_x + (float(point[0]) - float(decoded_min[0])) * scale)
    raw_y = math.floor(
        offset_y + (float(point[1]) - float(decoded_min[1])) * scale
    )
    return [
        max(0, min(width - 1, x)),
        max(0, min(height - 1, height - 1 - raw_y)),
    ]


def seal_review(payload: dict[str, object]) -> dict[str, object]:
    unsigned = copy.deepcopy(payload)
    unsigned.pop("reportSha256", None)
    sealed = copy.deepcopy(unsigned)
    sealed["reportSha256"] = hashlib.sha256(
        REVIEW_DIGEST_DOMAIN + alignment._canonical_json_bytes(unsigned)
    ).hexdigest()
    return sealed


def make_review(
    model: Path,
    points: np.ndarray,
    *,
    polygon_intrinsic: list[list[int]] | None = None,
    included_indices: list[int] | None = None,
) -> dict[str, object]:
    mapping = uniform_mapping(points)
    decoded_min = np.min(points, axis=0)
    decoded_max = np.max(points, axis=0)
    if polygon_intrinsic is None:
        polygon_intrinsic = [
            [0, 0],
            [1023, 0],
            [1023, 1023],
            [0, 1023],
        ]
    if included_indices is None:
        included_indices = list(range(len(points)))
    if included_indices:
        included = points[np.asarray(included_indices, dtype=np.int64)]
        included_bounds: dict[str, object] | None = {
            "min": [float(value) for value in np.min(included, axis=0)],
            "max": [float(value) for value in np.max(included, axis=0)],
        }
    else:
        included_bounds = None
    previews = [
        preview_row(view_id, axes, omitted)
        for view_id, axes, omitted in PREVIEW_VIEW_SPECS
    ]
    payload: dict[str, object] = {
        "schemaVersion": "omnitwin.foundry.room-envelope-review.v0",
        "authority": "none",
        "source": {
            "receiptSha256": hashlib.sha256(b"fixture-render-receipt").hexdigest(),
            "sourceFactsSha256": hashlib.sha256(b"fixture-source-facts").hexdigest(),
            "bundleRoot": "",
            "bundleSha256": FIXTURE_BUNDLE_SHA256,
            "members": fixture_member_rows(model),
            "preview": copy.deepcopy(previews[0]),
        },
        "review": {
            "roomLabel": "Reception Room",
            "reviewerLabel": "fixture operator",
            "reviewedAt": "2026-07-19T12:34:56.000Z",
            "decision": "accepted_as_fit_seed",
            "note": "Synthetic fixture review; fit seed only.",
            "reviewedPreviews": previews,
        },
        "selection": {
            "horizontalViewId": "position_0_1",
            "projectedAxes": [0, 1],
            "omittedAxis": 2,
            "polygonIntrinsicPixels": polygon_intrinsic,
            "polygonDecoderCoordinates": intrinsic_to_decoder(
                polygon_intrinsic, mapping
            ),
            "mapping": mapping,
            "includedRecordCount": len(included_indices),
            "excludedRecordCount": len(points) - len(included_indices),
            "includedDecodedBounds": included_bounds,
        },
        "eligibility": "eligible_for_fit_only_diagnostic",
        "policy": {
            "fitOnlyDiagnostic": True,
            "validationInputsRead": False,
            "sourceBytesMutated": False,
            "networkUsed": False,
        },
        "limitations": REVIEW_LIMITATIONS,
    }
    return seal_review(payload)


def write_review(path: Path, review: dict[str, object]) -> None:
    path.write_bytes(alignment._canonical_json_bytes(review))


class SyntheticFitOnlyE57Adapter:
    def __init__(self, source: np.ndarray, *, mirrored: bool = False) -> None:
        self.requested: tuple[int, ...] | None = None
        rotation = np.diag([-1.0, 1.0, 1.0]) if mirrored else np.eye(3, dtype=np.float64)
        translation = np.asarray([4.3, -1.7, 2.2], dtype=np.float64)
        self.target = source @ rotation.T + translation

    def read_samples(
        self, _path: Path, scan_ids: tuple[int, ...], _per_scan_limit: int
    ) -> dict[str, object]:
        self.requested = tuple(scan_ids)
        return {
            "adapter": {"name": "synthetic-fit-only-firewall-spy", "version": "test"},
            "scanCount": 149,
            "rawPointCounts": {scan_id: len(self.target) for scan_id in scan_ids},
            "organizedSampling": {},
            "pointsByScan": {scan_id: self.target.copy() for scan_id in scan_ids},
        }


class ExtraValidationScanAdapter(SyntheticFitOnlyE57Adapter):
    def read_samples(
        self, path: Path, scan_ids: tuple[int, ...], per_scan_limit: int
    ) -> dict[str, object]:
        result = super().read_samples(path, scan_ids, per_scan_limit)
        points = result["pointsByScan"]
        assert isinstance(points, dict)
        points[diagnostic.VALIDATION_SCAN_IDS[0]] = self.target.copy()
        return result


class FitOnlyEnvelopeTests(unittest.TestCase):
    def _arguments(
        self,
        model: Path,
        e57: Path,
        review: Path,
        output: Path,
        *,
        crop_margin_decoder: float = 0.05,
    ) -> SimpleNamespace:
        return SimpleNamespace(
            potree_model=model,
            e57=e57,
            room_envelope_review=review,
            output=output,
            potree_sample_points=640,
            points_per_scan=640,
            maximum_iterations=5,
            trim_fraction=0.8,
            overlap_distance_m=0.20,
            crop_margin_decoder=crop_margin_decoder,
            verify_e57_bytes=False,
        )

    def _run_test_adapter(
        self,
        arguments: SimpleNamespace,
        adapter: SyntheticFitOnlyE57Adapter,
        e57_size: int,
    ) -> dict[str, object]:
        with (
            mock.patch.object(diagnostic, "RECEPTION_E57_SIZE_BYTES", e57_size),
            mock.patch.object(alignment, "RECEPTION_E57_SIZE_BYTES", e57_size),
            mock.patch.object(
                fit_envelope, "RECEPTION_E57_SIZE_BYTES", e57_size, create=True
            ),
        ):
            return fit_envelope.run_fit_only(
                arguments,
                e57_adapter=adapter,
                enforce_production_pins=False,
                _test_only_allow_custom_e57_adapter=True,
                expected_bundle_sha256=FIXTURE_BUNDLE_SHA256,
            )

    def test_real_typescript_proposal_digest_binds_before_unaccepted_refusal(self) -> None:
        proposal = (
            MODULE_ROOT.parents[1]
            / "docs"
            / "reports"
            / "reception-room-envelope-review-proposal-v0-2026-07-19.json"
        )
        self.assertTrue(proposal.is_file())
        structurally_valid = fit_envelope._load_room_envelope_review(
            proposal,
            expected_bundle_sha256=fit_envelope.RECEPTION_POTREE_BUNDLE_SHA256,
            require_accepted=False,
        )
        self.assertEqual(
            structurally_valid.document["reportSha256"],
            "1721c64993fe9a90c9c4ef4e1d5b438d5bb65880235bdd747feea4beedfbc209",
        )
        with self.assertRaises(alignment.AlignmentError) as raised:
            fit_envelope.parse_room_envelope_review(
                proposal,
                expected_bundle_sha256=fit_envelope.RECEPTION_POTREE_BUNDLE_SHA256,
            )
        # This decision error is reached only after strict structure, exact
        # Reception pins, mapping self-consistency, and the TS digest verify.
        self.assertEqual(raised.exception.code, "ROOM_ENVELOPE_REVIEW_NOT_ACCEPTED")

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "must-not-exist.json"
            adapter = mock.Mock()
            arguments = self._arguments(
                root / "missing-potree",
                root / "missing.e57",
                proposal,
                output,
            )
            with self.assertRaises(alignment.AlignmentError) as run_raised:
                fit_envelope.run_fit_only(
                    arguments,
                    e57_adapter=adapter,
                    enforce_production_pins=False,
                    _test_only_allow_custom_e57_adapter=True,
                )
            self.assertEqual(
                run_raised.exception.code, "ROOM_ENVELOPE_REVIEW_NOT_ACCEPTED"
            )
            adapter.read_samples.assert_not_called()
            self.assertFalse(output.exists())

    def test_strict_parser_accepts_only_digest_bound_self_consistent_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, points = write_fixture_model(root)
            members = fixture_member_rows(model)
            valid = make_review(model, points)
            path = root / "room-envelope-review.json"
            write_review(path, valid)

            parsed = fit_envelope.parse_room_envelope_review(
                path,
                expected_bundle_sha256=FIXTURE_BUNDLE_SHA256,
                expected_members=members,
            )
            self.assertEqual(parsed["authority"], "none")
            self.assertEqual(parsed["review"]["decision"], "accepted_as_fit_seed")
            self.assertEqual(parsed["eligibility"], "eligible_for_fit_only_diagnostic")

            hostile_reviews: list[tuple[str, dict[str, object]]] = []

            unknown_key = copy.deepcopy(valid)
            unknown_key["unexpected"] = True
            hostile_reviews.append(("unknown top-level key", seal_review(unknown_key)))

            coordinate_mismatch = copy.deepcopy(valid)
            decoder_coordinates = coordinate_mismatch["selection"][  # type: ignore[index]
                "polygonDecoderCoordinates"
            ]
            assert isinstance(decoder_coordinates, list)
            decoder_coordinates[0][0] += 0.01
            hostile_reviews.append(
                ("intrinsic/decoder mismatch", seal_review(coordinate_mismatch))
            )

            self_intersection = copy.deepcopy(valid)
            intrinsic_polygon = self_intersection["selection"][  # type: ignore[index]
                "polygonIntrinsicPixels"
            ]
            assert isinstance(intrinsic_polygon, list)
            intrinsic_polygon[1], intrinsic_polygon[2] = (
                intrinsic_polygon[2],
                intrinsic_polygon[1],
            )
            mapping = self_intersection["selection"]["mapping"]  # type: ignore[index]
            assert isinstance(mapping, dict)
            self_intersection["selection"][  # type: ignore[index]
                "polygonDecoderCoordinates"
            ] = intrinsic_to_decoder(intrinsic_polygon, mapping)
            hostile_reviews.append(
                ("self-intersecting polygon", seal_review(self_intersection))
            )

            wrong_digest = copy.deepcopy(valid)
            wrong_digest["reportSha256"] = "0" * 64
            hostile_reviews.append(("wrong report digest", wrong_digest))

            numeric_policy = copy.deepcopy(valid)
            numeric_policy["policy"] = {
                "fitOnlyDiagnostic": 1,
                "validationInputsRead": 0,
                "sourceBytesMutated": 0,
                "networkUsed": 0,
            }
            hostile_reviews.append(
                ("numeric values are not policy booleans", seal_review(numeric_policy))
            )

            for label, hostile in hostile_reviews:
                with self.subTest(label=label):
                    write_review(path, hostile)
                    with self.assertRaises(alignment.AlignmentError):
                        fit_envelope.parse_room_envelope_review(
                            path,
                            expected_bundle_sha256=FIXTURE_BUNDLE_SHA256,
                            expected_members=members,
                        )

            rebound_root = copy.deepcopy(valid)
            rebound_root["source"]["bundleRoot"] = "rebound"  # type: ignore[index]
            for member in rebound_root["source"]["members"]:  # type: ignore[index]
                member["relativePath"] = f"rebound/{member['relativePath']}"
            write_review(path, seal_review(rebound_root))
            with self.assertRaises(alignment.AlignmentError) as rebound_raised:
                fit_envelope.parse_room_envelope_review(
                    path,
                    expected_bundle_sha256=FIXTURE_BUNDLE_SHA256,
                )
            self.assertEqual(
                rebound_raised.exception.code,
                "ROOM_ENVELOPE_BUNDLE_DIGEST_MISMATCH",
            )

            dot_root = copy.deepcopy(valid)
            dot_root["source"]["bundleRoot"] = "."  # type: ignore[index]
            for member in dot_root["source"]["members"]:  # type: ignore[index]
                member["relativePath"] = f"./{member['relativePath']}"
            write_review(path, seal_review(dot_root))
            with self.assertRaises(alignment.AlignmentError) as dot_raised:
                fit_envelope.parse_room_envelope_review(
                    path,
                    expected_bundle_sha256=FIXTURE_BUNDLE_SHA256,
                )
            self.assertEqual(dot_raised.exception.code, "INVALID_ROOM_ENVELOPE_MEMBER")

    def test_wrong_bundle_and_unaccepted_review_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, points = write_fixture_model(root)
            members = fixture_member_rows(model)
            path = root / "room-envelope-review.json"

            wrong_bundle = make_review(model, points)
            wrong_bundle["source"]["bundleSha256"] = "f" * 64  # type: ignore[index]
            write_review(path, seal_review(wrong_bundle))
            with self.assertRaises(alignment.AlignmentError):
                fit_envelope.parse_room_envelope_review(
                    path,
                    expected_bundle_sha256=FIXTURE_BUNDLE_SHA256,
                    expected_members=members,
                )

            unaccepted = make_review(model, points)
            unaccepted["review"]["decision"] = "needs_revision"  # type: ignore[index]
            unaccepted["eligibility"] = "not_eligible"
            write_review(path, seal_review(unaccepted))
            with self.assertRaises(alignment.AlignmentError):
                fit_envelope.parse_room_envelope_review(
                    path,
                    expected_bundle_sha256=FIXTURE_BUNDLE_SHA256,
                    expected_members=members,
                )

            ineligible = make_review(
                model, points, included_indices=list(range(511))
            )
            ineligible["eligibility"] = "not_eligible"
            write_review(path, seal_review(ineligible))
            with self.assertRaises(alignment.AlignmentError):
                fit_envelope.parse_room_envelope_review(
                    path,
                    expected_bundle_sha256=FIXTURE_BUNDLE_SHA256,
                    expected_members=members,
                )

    def test_non_test_execution_cannot_bypass_exact_reception_pins(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            arguments = self._arguments(
                root / "missing-model",
                root / "missing.e57",
                root / "missing-review.json",
                root / "must-not-exist.json",
            )
            for overrides in (
                {"enforce_production_pins": False},
                {"expected_bundle_sha256": FIXTURE_BUNDLE_SHA256},
            ):
                with self.subTest(overrides=overrides):
                    with self.assertRaises(alignment.AlignmentError) as raised:
                        fit_envelope.run_fit_only(arguments, **overrides)
                    self.assertEqual(
                        raised.exception.code, "PRODUCTION_PIN_BYPASS_FORBIDDEN"
                    )
                    self.assertFalse(arguments.output.exists())

    def test_insufficient_inverse_mapped_crop_emits_authority_none_refusal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, points = write_fixture_model(root / "input" / "potree")
            e57 = root / "input" / "capture.e57"
            e57_payload = b"synthetic-read-only-e57"
            e57.write_bytes(e57_payload)
            mapping = uniform_mapping(points)
            centre = decoder_point_to_intrinsic(points[0], mapping)
            radius = 5
            polygon = [
                [centre[0] - radius, centre[1] - radius],
                [centre[0] + radius, centre[1] - radius],
                [centre[0] + radius, centre[1] + radius],
                [centre[0] - radius, centre[1] + radius],
            ]
            self.assertTrue(
                all(0 <= coordinate <= 1023 for vertex in polygon for coordinate in vertex)
            )
            review_value = make_review(
                model, points, polygon_intrinsic=polygon
            )
            review = root / "input" / "room-envelope-review.json"
            write_review(review, review_value)
            output = root / "output" / "fit-only-refusal.json"
            output.parent.mkdir()
            adapter = SyntheticFitOnlyE57Adapter(points)

            receipt = self._run_test_adapter(
                self._arguments(
                    model, e57, review, output, crop_margin_decoder=0.0
                ),
                adapter,
                len(e57_payload),
            )

            self.assertEqual(adapter.requested, diagnostic.FIT_SCAN_IDS)
            self.assertEqual(receipt["authority"], "none")
            self.assertEqual(
                receipt["status"],
                "fit_only_envelope_refused_test_adapter_unusable_authority_none",
            )
            self.assertEqual(receipt["fitOnlyDiagnostic"]["outcome"], "refusal")
            self.assertEqual(
                receipt["fitOnlyDiagnostic"]["reason"]["code"],
                "INSUFFICIENT_ENVELOPE_CROP",
            )
            self.assertFalse(receipt["safety"]["approvedTransformArtifactCreated"])
            self.assertFalse(receipt["eligibility"]["eligibleForTransformRegistration"])
            self.assertEqual(
                receipt["resultType"], "test_adapter_result_unusable_as_evidence"
            )
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), receipt)

    def test_consumer_requests_exact_fit_scans_and_never_validation_scans(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, points = write_fixture_model(root / "input" / "potree")
            e57 = root / "input" / "capture.e57"
            e57_payload = b"synthetic-read-only-e57"
            e57.write_bytes(e57_payload)
            review = root / "input" / "room-envelope-review.json"
            write_review(review, make_review(model, points))
            output = root / "output" / "fit-only-candidate.json"
            output.parent.mkdir()
            adapter = SyntheticFitOnlyE57Adapter(points)

            receipt = self._run_test_adapter(
                self._arguments(model, e57, review, output),
                adapter,
                len(e57_payload),
            )

            self.assertEqual(adapter.requested, diagnostic.FIT_SCAN_IDS)
            self.assertFalse(set(adapter.requested or ()) & set(diagnostic.VALIDATION_SCAN_IDS))
            self.assertFalse(set(adapter.requested or ()) & set(diagnostic.FROZEN_TEST_SCAN_IDS))
            self.assertFalse(set(adapter.requested or ()) & set(diagnostic.QUARANTINED_SCAN_IDS))
            self.assertEqual(receipt["authority"], "none")
            self.assertEqual(
                receipt["status"],
                "fit_only_envelope_candidate_test_adapter_unusable_authority_none",
            )
            self.assertEqual(receipt["fitOnlyDiagnostic"]["outcome"], "candidate")
            self.assertEqual(
                receipt["scope"]["exactE57ScanIdsRequested"],
                list(diagnostic.FIT_SCAN_IDS),
            )
            self.assertEqual(receipt["scope"]["fitScanIds"], list(diagnostic.FIT_SCAN_IDS))
            self.assertTrue(receipt["scope"]["validationScanIdsNotRequestedByConsumer"])
            self.assertFalse(receipt["scope"]["validationUsedDuringFit"])
            self.assertEqual(
                receipt["scope"]["customAdapterReadOrUseOfUnrequestedScans"],
                "unestablished",
            )
            self.assertFalse(receipt["safety"]["approvedTransformArtifactCreated"])
            self.assertFalse(receipt["eligibility"]["eligibleForTransformRegistration"])
            self.assertFalse(
                receipt["fitOnlyDiagnostic"]["improperMirrorCompetitor"]
                ["isPermittedTransformCandidate"]
            )
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), receipt)

    def test_raw_adapter_extra_validation_scan_is_rejected_before_filtering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, points = write_fixture_model(root / "input" / "potree")
            e57 = root / "input" / "capture.e57"
            e57_payload = b"synthetic-read-only-e57"
            e57.write_bytes(e57_payload)
            review = root / "input" / "room-envelope-review.json"
            write_review(review, make_review(model, points))
            output = root / "output" / "must-not-exist.json"
            output.parent.mkdir()
            adapter = ExtraValidationScanAdapter(points)

            with self.assertRaises(alignment.AlignmentError) as raised:
                self._run_test_adapter(
                    self._arguments(model, e57, review, output),
                    adapter,
                    len(e57_payload),
                )

            self.assertEqual(adapter.requested, diagnostic.FIT_SCAN_IDS)
            self.assertEqual(raised.exception.code, "E57_ADAPTER_SCAN_SCOPE_MISMATCH")
            self.assertFalse(output.exists())

    def test_candidate_receipt_is_deterministic_and_create_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model, points = write_fixture_model(root / "input" / "potree")
            e57 = root / "input" / "capture.e57"
            e57_payload = b"synthetic-read-only-e57"
            e57.write_bytes(e57_payload)
            review = root / "input" / "room-envelope-review.json"
            write_review(review, make_review(model, points))
            output_a = root / "output" / "candidate-a.json"
            output_b = root / "output" / "candidate-b.json"
            output_a.parent.mkdir()

            receipt_a = self._run_test_adapter(
                self._arguments(model, e57, review, output_a),
                SyntheticFitOnlyE57Adapter(points),
                len(e57_payload),
            )
            receipt_b = self._run_test_adapter(
                self._arguments(model, e57, review, output_b),
                SyntheticFitOnlyE57Adapter(points),
                len(e57_payload),
            )

            self.assertEqual(receipt_a, receipt_b)
            self.assertEqual(output_a.read_bytes(), output_b.read_bytes())
            self.assertFalse(receipt_a["safety"]["approvedTransformArtifactCreated"])
            self.assertFalse(receipt_a["eligibility"]["eligibleForTransformRegistration"])

            original = output_a.read_bytes()
            with self.assertRaises(alignment.AlignmentError) as raised:
                self._run_test_adapter(
                    self._arguments(model, e57, review, output_a),
                    SyntheticFitOnlyE57Adapter(points),
                    len(e57_payload),
                )
            self.assertEqual(raised.exception.code, "OUTPUT_EXISTS")
            self.assertEqual(output_a.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
