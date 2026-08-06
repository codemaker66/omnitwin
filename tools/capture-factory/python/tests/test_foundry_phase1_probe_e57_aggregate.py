from __future__ import annotations

import hashlib
import importlib.metadata
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


PYTHON_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_ROOT))

import foundry_phase1_probe as probe


try:
    PYE57_VERSION = importlib.metadata.version("pye57")
except importlib.metadata.PackageNotFoundError:
    PYE57_VERSION = None


class FakeScalar:
    def __init__(self, value: object) -> None:
        self._value = value

    def value(self) -> object:
        return self._value


class FakeBlob:
    def __init__(self, byte_count: int) -> None:
        self._byte_count = byte_count

    def byteCount(self) -> int:
        return self._byte_count


class FakeNode:
    def __init__(self, **children: object) -> None:
        self.children = children

    def isDefined(self, name: str) -> bool:
        return name in self.children

    def __getitem__(self, name: str) -> object:
        return self.children[name]


class FakeVector:
    def __init__(self, records: list[FakeNode], declared_length: int | None = None) -> None:
        self.records = records
        self.declared_length = len(records) if declared_length is None else declared_length

    def __len__(self) -> int:
        return self.declared_length

    def __getitem__(self, index: int) -> FakeNode:
        return self.records[index]


class FakeHeader:
    def __init__(self, point_count: int, point_fields: list[str]) -> None:
        self.point_count = point_count
        self.point_fields = point_fields


class FakeNamedChild:
    def __init__(self, name: str) -> None:
        self.name = name

    def elementName(self) -> str:
        return self.name


class FakePrototype:
    def __init__(self, field_names: list[str]) -> None:
        self.children = [FakeNamedChild(name) for name in field_names]

    def childCount(self) -> int:
        return len(self.children)

    def get(self, index: int) -> FakeNamedChild:
        return self.children[index]


class FakeCompressedVector:
    def __init__(self, point_count: int, point_fields: list[str]) -> None:
        self.point_count = point_count
        self.point_fields = point_fields

    def childCount(self) -> int:
        return self.point_count

    def prototype(self) -> FakePrototype:
        return FakePrototype(self.point_fields)


class FakeOpenE57:
    def __init__(
        self,
        scans: list[FakeNode],
        headers: list[FakeHeader],
        *,
        images: list[FakeNode] | None = None,
        coordinate_metadata: str | None = None,
        declared_scan_count: int | None = None,
        declared_image_count: int | None = None,
    ) -> None:
        root_children: dict[str, object] = {}
        if images is not None:
            root_children["images2D"] = FakeVector(images, declared_image_count)
        if coordinate_metadata is not None:
            root_children["coordinateMetadata"] = FakeScalar(coordinate_metadata)
        self.root = FakeNode(**root_children)
        self.data3d = scans
        self.headers = headers
        for scan, header in zip(scans, headers, strict=True):
            scan.children["points"] = FakeCompressedVector(
                header.point_count, header.point_fields
            )
        self.scan_count = len(scans) if declared_scan_count is None else declared_scan_count

    def get_header(self, index: int) -> FakeHeader:
        return self.headers[index]


def scalar_structure(**values: float) -> FakeNode:
    return FakeNode(**{name: FakeScalar(value) for name, value in values.items()})


def pose_node(*, translation_x: float = 0.0) -> FakeNode:
    return FakeNode(
        pose=FakeNode(
            rotation=scalar_structure(w=1.0, x=0.0, y=0.0, z=0.0),
            translation=scalar_structure(x=translation_x, y=0.0, z=0.0),
        )
    )


def representation(**blob_sizes: int) -> FakeNode:
    return FakeNode(**{name: FakeBlob(size) for name, size in blob_sizes.items()})


class FakeAggregateAdapter:
    adapter_name = "fake-pye57"
    adapter_version = "0.4.19-test"

    def __init__(self, e57: FakeOpenE57, file_size: int) -> None:
        self.e57 = e57
        self.file_size = file_size

    def inspect(self, path: Path) -> dict[str, object]:
        return probe._aggregate_e57_open_file(self.e57, self.file_size)


class E57AggregateProbeTests(unittest.TestCase):
    def test_zero_scan_file_has_complete_deterministic_empty_aggregate(self) -> None:
        opened = FakeOpenE57([], [], images=[])
        result = probe._aggregate_e57_open_file(opened, 48)
        self.assertEqual(
            {
                "blobDeclarationHistogram": [],
                "coordinateMetadata": {
                    "present": False,
                    "sha256": None,
                    "utf8ByteCount": 0,
                },
                "declaredImageBlobByteTotal": "0",
                "declaredPointRecordTotal": "0",
                "file": {"byteSize": 48},
                "imageCount": 0,
                "imagePoseCounts": {"absent": 0, "present": 0},
                "imageRepresentationCardinality": {
                    "absent": 0,
                    "multiple": 0,
                    "single": 0,
                },
                "imageRepresentationHistogram": [],
                "pointFieldCoverage": [],
                "scanCount": 0,
                "scanPoseCounts": {"absent": 0, "present": 0},
            },
            result,
        )

    def test_missing_poses_are_allowed_and_point_fields_are_canonical_coverage(self) -> None:
        opened = FakeOpenE57(
            [FakeNode(), pose_node()],
            [
                FakeHeader(7, ["intensity", "cartesianX", "cartesianX"]),
                FakeHeader(5, ["cartesianZ", "cartesianX"]),
            ],
        )
        result = probe._aggregate_e57_open_file(opened, 1_000)
        self.assertEqual("12", result["declaredPointRecordTotal"])
        self.assertEqual({"absent": 1, "present": 1}, result["scanPoseCounts"])
        self.assertEqual(
            [
                {"field": "cartesianX", "scanCount": 2},
                {"field": "cartesianZ", "scanCount": 1},
                {"field": "intensity", "scanCount": 1},
            ],
            result["pointFieldCoverage"],
        )

    def test_absent_and_multiple_image_representations_are_aggregated_not_rejected(self) -> None:
        metadata = "EPSG:27700"
        opened = FakeOpenE57(
            [],
            [],
            images=[
                FakeNode(),
                FakeNode(pinholeRepresentation=representation(jpegImage=10)),
                FakeNode(
                    pose=pose_node().children["pose"],
                    sphericalRepresentation=representation(pngImage=20),
                    visualReferenceRepresentation=representation(imageMask=5),
                ),
            ],
            coordinate_metadata=metadata,
        )
        result = probe._aggregate_e57_open_file(opened, 100)
        self.assertEqual(3, result["imageCount"])
        self.assertEqual({"absent": 2, "present": 1}, result["imagePoseCounts"])
        self.assertEqual(
            {"absent": 1, "multiple": 1, "single": 1},
            result["imageRepresentationCardinality"],
        )
        self.assertEqual(
            [
                {"declarationCount": 1, "kind": "pinholeRepresentation"},
                {"declarationCount": 1, "kind": "sphericalRepresentation"},
                {"declarationCount": 1, "kind": "visualReferenceRepresentation"},
            ],
            result["imageRepresentationHistogram"],
        )
        self.assertEqual(
            [
                {"declarationCount": 1, "declaredByteTotal": "5", "kind": "imageMask"},
                {"declarationCount": 1, "declaredByteTotal": "10", "kind": "jpegImage"},
                {"declarationCount": 1, "declaredByteTotal": "20", "kind": "pngImage"},
            ],
            result["blobDeclarationHistogram"],
        )
        self.assertEqual("35", result["declaredImageBlobByteTotal"])
        self.assertEqual(
            {
                "present": True,
                "sha256": hashlib.sha256(metadata.encode("utf-8")).hexdigest(),
                "utf8ByteCount": len(metadata.encode("utf-8")),
            },
            result["coordinateMetadata"],
        )
        self.assertNotIn(metadata, probe.canonical_json_line(result))

    def test_wrapper_declares_read_only_behavior_and_output_is_canonical(self) -> None:
        opened = FakeOpenE57(
            [
                FakeNode(
                    guid=FakeScalar("scan-guid-not-emitted"),
                    name=FakeScalar("scan-name-not-emitted"),
                    sensorVendor=FakeScalar("sensor-vendor-not-emitted"),
                )
            ],
            [FakeHeader(2, ["cartesianX"])],
            images=[
                FakeNode(
                    guid=FakeScalar("image-guid-not-emitted"),
                    name=FakeScalar("image-name-not-emitted"),
                    imageUri=FakeScalar("https://example.invalid/not-emitted"),
                )
            ],
        )
        result = probe.inspect_e57_aggregate(
            Path("not-opened.e57"), FakeAggregateAdapter(opened, 512)
        )
        self.assertEqual("read-only", result["openMode"])
        self.assertFalse(result["pointRecordsRead"])
        self.assertFalse(result["imageBlobBytesRead"])
        document = {
            "mode": "inspect-e57-aggregate",
            "result": result,
            "schemaVersion": probe.SCHEMA_VERSION,
            "status": "ok",
        }
        first = probe.canonical_json_line(document)
        second = probe.canonical_json_line(json.loads(first))
        self.assertEqual(first, second)
        for forbidden in (
            "scan-guid-not-emitted",
            "scan-name-not-emitted",
            "sensor-vendor-not-emitted",
            "image-guid-not-emitted",
            "image-name-not-emitted",
            "https://example.invalid/not-emitted",
        ):
            self.assertNotIn(forbidden, first)
        arguments = probe.build_parser().parse_args(
            ["inspect-e57-aggregate", "--e57", "fixture.e57"]
        )
        self.assertEqual("inspect-e57-aggregate", arguments.mode)

    def test_rejects_giant_coordinate_metadata_and_point_field_scalars(self) -> None:
        giant = "x" * (probe.MAX_E57_METADATA_SCALAR_BYTES + 1)
        with self.assertRaises(probe.ProbeError) as metadata_error:
            probe._aggregate_e57_open_file(
                FakeOpenE57([], [], coordinate_metadata=giant), 2_000_000
            )
        self.assertEqual("E57_METADATA_SCALAR_TOO_LARGE", metadata_error.exception.code)

        with self.assertRaises(probe.ProbeError) as field_error:
            probe._aggregate_e57_open_file(
                FakeOpenE57([FakeNode()], [FakeHeader(0, [giant])]), 2_000_000
            )
        self.assertEqual("E57_METADATA_SCALAR_TOO_LARGE", field_error.exception.code)

    def test_rejects_negative_and_oversized_declarations(self) -> None:
        cases = (
            (
                FakeOpenE57([], [], declared_scan_count=-1),
                1_000,
                "E57 scan count is negative",
            ),
            (
                FakeOpenE57([FakeNode()], [FakeHeader(-1, [])]),
                1_000,
                "E57 scan 0 point-record count is negative",
            ),
            (
                FakeOpenE57(
                    [FakeNode()],
                    [FakeHeader(probe.MAX_E57_DECLARED_UNSIGNED_INTEGER + 1, [])],
                ),
                1_000,
                "point-record count exceeds",
            ),
            (
                FakeOpenE57(
                    [], [], declared_scan_count=probe.MAX_E57_METADATA_RECORDS + 1
                ),
                1_000,
                "E57 scan count exceeds",
            ),
            (
                FakeOpenE57(
                    [],
                    [],
                    images=[],
                    declared_image_count=probe.MAX_E57_METADATA_RECORDS + 1,
                ),
                1_000,
                "E57 image metadata count exceeds",
            ),
            (
                FakeOpenE57(
                    [],
                    [],
                    images=[
                        FakeNode(
                            pinholeRepresentation=representation(jpegImage=-1)
                        )
                    ],
                ),
                1_000,
                "jpegImage byte count is negative",
            ),
            (
                FakeOpenE57(
                    [],
                    [],
                    images=[
                        FakeNode(
                            pinholeRepresentation=representation(jpegImage=1_001)
                        )
                    ],
                ),
                1_000,
                "jpegImage byte count exceeds",
            ),
            (
                FakeOpenE57([], []),
                probe.MAX_E57_FILE_BYTES + 1,
                "E57 file byte size exceeds",
            ),
        )
        for opened, file_size, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(probe.ProbeError, message):
                    probe._aggregate_e57_open_file(opened, file_size)

    def test_rejects_distinct_field_overflow_and_nonfinite_optional_pose(self) -> None:
        with patch.object(probe, "MAX_E57_DISTINCT_POINT_FIELDS", 1):
            with self.assertRaises(probe.ProbeError) as fields_error:
                probe._aggregate_e57_open_file(
                    FakeOpenE57(
                        [FakeNode()], [FakeHeader(0, ["cartesianX", "cartesianY"])]
                    ),
                    1_000,
                )
        self.assertEqual("E57_POINT_FIELD_LIMIT", fields_error.exception.code)

        with self.assertRaises(probe.ProbeError) as pose_error:
            probe._aggregate_e57_open_file(
                FakeOpenE57([pose_node(translation_x=float("inf"))], [FakeHeader(0, [])]),
                1_000,
            )
        self.assertEqual("NONFINITE_VALUE", pose_error.exception.code)

    @unittest.skipUnless(
        PYE57_VERSION == probe.REQUIRED_PYE57_VERSION,
        "requires the pinned pye57 runtime",
    )
    def test_real_tiny_e57_reads_metadata_without_point_reader_calls(self) -> None:
        import pye57

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "tiny.e57"
            coordinates = {
                "cartesianX": np.array([1.0, 2.0]),
                "cartesianY": np.array([3.0, 4.0]),
                "cartesianZ": np.array([5.0, 6.0]),
            }
            with pye57.E57(str(path), mode="w") as writer:
                writer.write_scan_raw(coordinates, name="not-emitted")

            with (
                patch.object(
                    pye57.E57,
                    "get_header",
                    side_effect=AssertionError("get_header called"),
                ),
                patch.object(
                    pye57.E57,
                    "read_scan",
                    side_effect=AssertionError("read_scan called"),
                ),
                patch.object(
                    pye57.E57,
                    "read_scan_raw",
                    side_effect=AssertionError("read_scan_raw called"),
                ),
            ):
                document = probe.execute(
                    ["inspect-e57-aggregate", "--e57", str(path)]
                )

        self.assertEqual("inspect-e57-aggregate", document["mode"])
        self.assertEqual("ok", document["status"])
        result = document["result"]
        self.assertEqual(1, result["scanCount"])
        self.assertEqual("2", result["declaredPointRecordTotal"])
        self.assertEqual({"absent": 0, "present": 1}, result["scanPoseCounts"])
        self.assertEqual(
            [
                {"field": "cartesianX", "scanCount": 1},
                {"field": "cartesianY", "scanCount": 1},
                {"field": "cartesianZ", "scanCount": 1},
            ],
            result["pointFieldCoverage"],
        )
        self.assertFalse(result["pointRecordsRead"])
        self.assertFalse(result["imageBlobBytesRead"])


if __name__ == "__main__":
    unittest.main()
