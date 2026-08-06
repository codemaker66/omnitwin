from __future__ import annotations

import hashlib
import math
import sqlite3
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


PYTHON_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PYTHON_ROOT))

import foundry_phase1_probe as probe


def write_bytes(root: Path, name: str, data: bytes) -> Path:
    path = root / name
    path.write_bytes(data)
    return path


def cameras_binary(records: list[tuple[int, int, int, int, list[float]]]) -> bytes:
    payload = bytearray(struct.pack("<Q", len(records)))
    for camera_id, model_id, width, height, params in records:
        payload += struct.pack("<iiQQ", camera_id, model_id, width, height)
        payload += struct.pack("<" + "d" * len(params), *params)
    return bytes(payload)


def image_record(
    image_id: int,
    name: bytes,
    *,
    camera_id: int = 1,
    qvec: tuple[float, float, float, float] = (1.0, 0.0, 0.0, 0.0),
    tvec: tuple[float, float, float] = (0.0, 0.0, 0.0),
    points: list[tuple[float, float, int]] | None = None,
    nul: bool = True,
) -> bytes:
    observations = [] if points is None else points
    payload = bytearray(struct.pack("<i7di", image_id, *qvec, *tvec, camera_id))
    payload += name
    if nul:
        payload += b"\0"
        payload += struct.pack("<Q", len(observations))
        for x, y, point_id in observations:
            payload += struct.pack("<ddq", x, y, point_id)
    return bytes(payload)


def images_binary(records: list[bytes]) -> bytes:
    return struct.pack("<Q", len(records)) + b"".join(records)


def points_binary(records: list[tuple[int, tuple[float, float, float], float, list[tuple[int, int]]]]) -> bytes:
    payload = bytearray(struct.pack("<Q", len(records)))
    for point_id, xyz, error, track in records:
        payload += struct.pack("<QdddBBBd", point_id, *xyz, 1, 2, 3, error)
        payload += struct.pack("<Q", len(track))
        for image_id, point_index in track:
            payload += struct.pack("<ii", image_id, point_index)
    return bytes(payload)


def frames_binary() -> bytes:
    return (
        struct.pack("<Q", 1)
        + struct.pack("<II7dI", 17, 4, 1.0, 0.0, 0.0, 0.0, 1.0, 2.0, 3.0, 1)
        + struct.pack("<IIQ", 0, 9, 101)
    )


def rigs_binary() -> bytes:
    return (
        struct.pack("<Q", 1)
        + struct.pack("<II", 4, 2)
        + struct.pack("<II", 0, 9)
        + struct.pack("<III7d", 0, 10, 1, 1.0, 0.0, 0.0, 0.0, 0.1, 0.2, 0.3)
    )


def jpeg_bytes(width: int = 1024, height: int = 512) -> bytes:
    app0 = b"\xff\xe0" + struct.pack(">H", 4) + b"AB"
    components = bytes((1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1))
    sof_payload = bytes((8,)) + struct.pack(">HHB", height, width, 3) + components
    sof = b"\xff\xc0" + struct.pack(">H", len(sof_payload) + 2) + sof_payload
    return b"\xff\xd8" + app0 + sof + b"\xff\xd9"


def create_colmap_database(path: Path, extra_sql: str = "") -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        f"""
        CREATE TABLE cameras(
            camera_id INTEGER PRIMARY KEY,
            model INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            params BLOB NOT NULL,
            prior_focal_length INTEGER NOT NULL
        );
        CREATE TABLE images(
            image_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            camera_id INTEGER NOT NULL
        );
        INSERT INTO cameras VALUES(7,1,1024,1024,zeroblob(32),0);
        INSERT INTO images VALUES(11,'scan_000_front.jpg',7);
        {extra_sql}
        """
    )
    connection.commit()
    connection.close()


class FakeE57Adapter:
    adapter_name = "fake-e57"
    adapter_version = "test-v1"

    def __init__(self, centers: list[list[float]]) -> None:
        self.centers = centers

    def inspect(self, path: Path) -> dict[str, object]:
        return {
            "file": {"byteSize": 123},
            "imageCount": 0,
            "images2D": [],
            "root": {"formatName": "fixture"},
            "scanCount": len(self.centers),
            "scans": [
                {
                    "guid": f"scan-{index}",
                    "index": index,
                    "name": f"Scan {index}",
                    "pointCount": 0,
                    "pointFields": [],
                    "pose": {
                        "qvecHamiltonWxyz": [1.0, 0.0, 0.0, 0.0],
                        "translation": center,
                    },
                }
                for index, center in enumerate(self.centers)
            ],
        }


class ColmapBinaryParserTests(unittest.TestCase):
    def test_parses_noncontiguous_camera_and_image_ids(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cameras_path = write_bytes(
                root,
                "cameras.bin",
                cameras_binary(
                    [
                        (9, 0, 640, 480, [500.0, 320.0, 240.0]),
                        (2, 1, 1024, 1024, [510.0, 511.0, 512.0, 513.0]),
                    ]
                ),
            )
            images_path = write_bytes(
                root,
                "images.bin",
                images_binary(
                    [
                        image_record(41, b"scan_010_front.jpg", camera_id=9),
                        image_record(3, b"scan_000_back.jpg", camera_id=2),
                    ]
                ),
            )
            cameras = probe.parse_cameras_binary(cameras_path)
            images = probe.parse_images_binary(images_path)
            self.assertEqual([2, 9], [item["cameraId"] for item in cameras["records"]])
            self.assertEqual([3, 41], [item["imageId"] for item in images["records"]])
            self.assertEqual(2, images["count"])

    def test_parses_points_frames_and_rigs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            points = probe.parse_points3d_binary(
                write_bytes(
                    root,
                    "points3D.bin",
                    points_binary([(99, (1.0, 2.0, 3.0), 0.5, [(7, 8), (9, 10)])]),
                )
            )
            frames = probe.parse_frames_binary(
                write_bytes(root, "frames.bin", frames_binary())
            )
            rigs = probe.parse_rigs_binary(write_bytes(root, "rigs.bin", rigs_binary()))
            self.assertEqual(2, points["totalTrackElements"])
            self.assertEqual([1.0, 2.0, 3.0], points["bounds"]["minimum"])
            self.assertEqual(101, frames["records"][0]["dataIds"][0]["dataId"])
            self.assertEqual(2, rigs["records"][0]["sensorCount"])
            self.assertEqual([0.1, 0.2, 0.3], rigs["records"][0]["sensors"][1]["sensorFromRig"]["translation"])

    def test_rejects_malicious_count_and_trailing_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            malicious = write_bytes(
                root, "malicious.bin", struct.pack("<Q", probe.MAX_RECORDS + 1)
            )
            with self.assertRaisesRegex(probe.ProbeError, "count exceeds"):
                probe.parse_cameras_binary(malicious)
            trailing = write_bytes(
                root,
                "trailing.bin",
                cameras_binary([(1, 0, 2, 2, [1.0, 1.0, 1.0])]) + b"x",
            )
            with self.assertRaisesRegex(probe.ProbeError, "trailing bytes"):
                probe.parse_cameras_binary(trailing)

    def test_rejects_truncated_and_unterminated_image_records(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            truncated = write_bytes(root, "truncated.bin", struct.pack("<Q", 1) + b"x")
            with self.assertRaisesRegex(probe.ProbeError, "truncated"):
                probe.parse_images_binary(truncated)
            unterminated = write_bytes(
                root,
                "unterminated.bin",
                images_binary([image_record(1, b"scan_000_front.jpg", nul=False)]),
            )
            with self.assertRaisesRegex(probe.ProbeError, "NUL terminator"):
                probe.parse_images_binary(unterminated)

    def test_rejects_empty_duplicate_names_ids_and_non_normalized_quaternion(self) -> None:
        cases = [
            (
                images_binary([image_record(1, b"")]),
                "is empty",
            ),
            (
                images_binary(
                    [
                        image_record(1, b"scan_000_front.jpg"),
                        image_record(2, b"scan_000_front.jpg"),
                    ]
                ),
                "duplicate image name",
            ),
            (
                images_binary(
                    [
                        image_record(1, b"scan_000_front.jpg"),
                        image_record(1, b"scan_000_back.jpg"),
                    ]
                ),
                "duplicate image id",
            ),
            (
                images_binary(
                    [image_record(1, b"scan_000_front.jpg", qvec=(2.0, 0.0, 0.0, 0.0))]
                ),
                "not normalized",
            ),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, (payload, expected) in enumerate(cases):
                path = write_bytes(root, f"case-{index}.bin", payload)
                with self.subTest(expected=expected), self.assertRaisesRegex(
                    probe.ProbeError, expected
                ):
                    probe.parse_images_binary(path)


class JpegAndGroupingTests(unittest.TestCase):
    def test_reads_jpeg_sof_without_image_library(self) -> None:
        result = probe.parse_jpeg_sof_bytes(jpeg_bytes())
        self.assertEqual(
            {
                "components": 3,
                "height": 512,
                "precisionBits": 8,
                "sofMarker": "SOF0",
                "width": 1024,
            },
            result,
        )

    def test_rejects_truncated_jpeg_and_noncanonical_sweep_names(self) -> None:
        with self.assertRaisesRegex(probe.ProbeError, "truncated segment"):
            probe.parse_jpeg_sof_bytes(jpeg_bytes()[:-5])
        for name in (
            "scan_1_front.jpg",
            "scan_001_FRONT.jpg",
            "directory/scan_001_front.jpg",
            "scan_001_front.jpeg",
        ):
            with self.subTest(name=name), self.assertRaises(probe.ProbeError):
                probe.parse_sweep_name(name)

    def test_grouping_is_canonical_and_detects_duplicate_faces(self) -> None:
        records = [
            {"name": "scan_002_down.jpg"},
            {"name": "scan_002_front.jpg"},
            {"name": "scan_000_left.jpg"},
        ]
        groups = probe.group_sweep_records(records)
        self.assertEqual([0, 2], [group["sweepIndex"] for group in groups])
        self.assertEqual(["front", "down"], groups[1]["presentFaces"])
        with self.assertRaisesRegex(probe.ProbeError, "duplicate front"):
            probe.group_sweep_records(
                [{"name": "scan_000_front.jpg"}, {"name": "scan_000_front.jpg"}]
            )


class SparseReferenceValidationTests(unittest.TestCase):
    def reference_fixture(self) -> tuple[dict, dict, dict, dict]:
        cameras = {"records": [{"cameraId": 7}]}
        images = {"records": [{"cameraId": 7, "imageId": 101}]}
        frames = {
            "status": "parsed",
            "records": [
                {
                    "frameId": 4,
                    "rigId": 3,
                    "dataIds": [{"sensorType": 0, "sensorId": 7, "dataId": 101}],
                }
            ],
        }
        rigs = {
            "status": "parsed",
            "records": [
                {"rigId": 3, "sensors": [{"sensorType": 0, "sensorId": 7}]}
            ],
        }
        return cameras, images, frames, rigs

    def test_accepts_consistent_camera_rig_frame_image_references(self) -> None:
        probe._validate_sparse_references(*self.reference_fixture())

    def test_rejects_frame_data_not_bound_to_registered_image(self) -> None:
        cameras, images, frames, rigs = self.reference_fixture()
        frames["records"][0]["dataIds"][0]["dataId"] = 999
        with self.assertRaisesRegex(probe.ProbeError, "frame camera data mismatch"):
            probe._validate_sparse_references(cameras, images, frames, rigs)


class AlignmentTests(unittest.TestCase):
    def test_camera_center_uses_hamilton_world_to_camera_convention(self) -> None:
        half = math.sqrt(0.5)
        qvec = [half, 0.0, 0.0, half]
        expected_center = np.array([2.0, -1.0, -3.0])
        rotation = probe.quaternion_world_to_camera_rotation(qvec)
        tvec = -(rotation @ expected_center)
        np.testing.assert_allclose(
            probe.colmap_camera_center(qvec, tvec), expected_center, atol=1e-12
        )

    def test_umeyama_recovers_known_proper_similarity(self) -> None:
        source = np.array(
            [
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
                [2.0, -1.0, 3.0],
            ]
        )
        angle = 0.37
        rotation = np.array(
            [
                [math.cos(angle), -math.sin(angle), 0.0],
                [math.sin(angle), math.cos(angle), 0.0],
                [0.0, 0.0, 1.0],
            ]
        )
        target = 1.75 * (source @ rotation.T) + np.array([4.0, -2.0, 7.0])
        result = probe.fit_similarity_umeyama(source, target)
        self.assertAlmostEqual(1.75, result.scale, places=12)
        np.testing.assert_allclose(rotation, result.rotation, atol=1e-12)
        np.testing.assert_allclose([4.0, -2.0, 7.0], result.translation, atol=1e-12)
        self.assertAlmostEqual(1.0, np.linalg.det(result.rotation), places=12)
        expected_matrix = np.eye(4)
        expected_matrix[:3, :3] = 1.75 * rotation
        expected_matrix[:3, 3] = [4.0, -2.0, 7.0]
        np.testing.assert_allclose(
            expected_matrix.flatten(order="F"),
            result.as_json()["matrixColumnMajor"],
            atol=1e-12,
        )

    def test_rejects_reflection_and_rank_deficiency(self) -> None:
        source = np.array(
            [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
        )
        reflected = source.copy()
        reflected[:, 0] *= -1.0
        with self.assertRaisesRegex(probe.ProbeError, "reflection"):
            probe.fit_similarity_umeyama(source, reflected)
        collinear = np.array([[float(index), 0.0, 0.0] for index in range(4)])
        with self.assertRaisesRegex(probe.ProbeError, "span 3D"):
            probe.fit_similarity_umeyama(collinear, collinear)

    def test_linear_percentiles_and_frozen_split_are_deterministic(self) -> None:
        statistics = probe.residual_statistics([0.0, 1.0, 2.0, 3.0])
        self.assertAlmostEqual(1.5, statistics["median"])
        self.assertAlmostEqual(2.85, statistics["p95"])
        self.assertAlmostEqual(math.sqrt(3.5), statistics["rmse"])
        self.assertEqual((5, 15, 25, 35, 44), probe.HELD_OUT_SWEEPS)
        self.assertEqual(50, len(probe.ALL_FIT_SWEEPS))
        self.assertEqual(49, len(probe.PHASE1_CANDIDATE_SWEEPS))

    def test_full_alignment_uses_fake_e57_and_exact_holdout(self) -> None:
        angle = 0.2
        rotation = np.array(
            [
                [math.cos(angle), 0.0, math.sin(angle)],
                [0.0, 1.0, 0.0],
                [-math.sin(angle), 0.0, math.cos(angle)],
            ]
        )
        source = np.array(
            [
                [float(index), float((index * index) % 13), float((index * 7) % 11)]
                for index in probe.ALL_FIT_SWEEPS
            ]
        )
        target = 2.25 * (source @ rotation.T) + np.array([10.0, -5.0, 3.0])
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory)
            write_bytes(
                model,
                "cameras.bin",
                cameras_binary([(1, 1, 100, 100, [50.0, 50.0, 50.0, 50.0])]),
            )
            records = [
                image_record(
                    index + 100,
                    f"scan_{index:03d}_front.jpg".encode("ascii"),
                    tvec=tuple(-value for value in source[index]),
                )
                for index in probe.ALL_FIT_SWEEPS
            ]
            write_bytes(model, "images.bin", images_binary(records))
            write_bytes(model, "points3D.bin", points_binary([]))
            result = probe.run_alignment(
                Path("unused.e57"), model, FakeE57Adapter(target.tolist())
            )
        candidate = result["phase1CandidateWithHoldout"]
        self.assertEqual(list(probe.HELD_OUT_SWEEPS), candidate["heldOutSweepIndices"])
        self.assertEqual(44, len(candidate["fitSweepIndices"]))
        self.assertNotIn(49, candidate["fitSweepIndices"])
        self.assertNotIn(49, candidate["candidateSweepIndices"])
        self.assertEqual(49, candidate["pilotEvaluation"]["statisticsMeters"]["count"])
        self.assertEqual(
            {
                "disposition": "excluded_adjacent_space",
                "sweepIndex": 49,
                "use": "reproduction_only",
            },
            result["scope"]["excludedSweeps"][0],
        )
        self.assertAlmostEqual(2.25, result["fullFit"]["transform"]["scale"], places=11)
        self.assertLess(result["fullFit"]["evaluation"]["statisticsMeters"]["rmse"], 1e-11)
        self.assertFalse(result["inputEvidence"]["e57"]["pointDataRead"])
        self.assertEqual(
            {
                "centerColmapWorld": source[0].tolist(),
                "face": "front",
                "imageName": "scan_000_front.jpg",
            },
            result["correspondences"][0]["colmapFaceCenters"][0],
        )

    def test_correspondence_mean_is_auditable_from_individual_face_centers(self) -> None:
        image_records = [
            {
                "name": f"scan_{sweep:03d}_{face}.jpg",
                "qvecHamiltonWxyz": [1.0, 0.0, 0.0, 0.0],
                "tvec": [-float(sweep), -offset, 0.0],
            }
            for sweep in probe.ALL_FIT_SWEEPS
            for face, offset in (("front", 0.0), ("back", 2.0))
        ]
        e57 = {
            "scans": [
                {"index": sweep, "pose": {"translation": [float(sweep), 1.0, 0.0]}}
                for sweep in probe.ALL_FIT_SWEEPS
            ]
        }
        result = probe.build_correspondences(image_records, e57)
        first = result[0]
        self.assertEqual(["front", "back"], first["registeredFaces"])
        self.assertEqual(
            ["scan_000_front.jpg", "scan_000_back.jpg"],
            [item["imageName"] for item in first["colmapFaceCenters"]],
        )
        np.testing.assert_allclose([0.0, 1.0, 0.0], first["colmapMeanCameraCenter"])
        np.testing.assert_allclose(
            np.mean(
                [item["centerColmapWorld"] for item in first["colmapFaceCenters"]], axis=0
            ),
            first["colmapMeanCameraCenter"],
        )


class SqliteAndEnvelopeTests(unittest.TestCase):
    def test_database_inspection_is_immutable_and_query_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "database.db"
            create_colmap_database(path)
            before = hashlib.sha256(path.read_bytes()).hexdigest()
            result = probe.inspect_colmap_database(path)
            after = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(before, after)
            self.assertTrue(result["immutable"])
            self.assertTrue(result["queryOnly"])
            self.assertFalse(result["trustedSchema"])
            self.assertFalse(result["rollbackJournalPresent"])
            self.assertEqual(1, result["tableCounts"]["images"])
            self.assertFalse(Path(str(path) + "-wal").exists())
            self.assertFalse(Path(str(path) + "-shm").exists())

    def test_accepts_expected_colmap_tables_and_legitimate_sqlite_sequence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "database.db"
            create_colmap_database(
                path,
                """
                CREATE TABLE rigs(rig_id INTEGER PRIMARY KEY AUTOINCREMENT);
                CREATE TABLE rig_sensors(rig_id INTEGER, sensor_type INTEGER, sensor_id INTEGER);
                CREATE TABLE frames(frame_id INTEGER PRIMARY KEY);
                CREATE TABLE frame_data(frame_id INTEGER, data_id INTEGER);
                CREATE TABLE pose_priors(image_id INTEGER PRIMARY KEY);
                CREATE TABLE keypoints(image_id INTEGER PRIMARY KEY, data BLOB);
                CREATE TABLE descriptors(image_id INTEGER PRIMARY KEY, data BLOB);
                CREATE TABLE matches(pair_id INTEGER PRIMARY KEY, data BLOB);
                CREATE TABLE two_view_geometries(pair_id INTEGER PRIMARY KEY, data BLOB);
                INSERT INTO rigs DEFAULT VALUES;
                """,
            )
            result = probe.inspect_colmap_database(path)
            self.assertEqual(1, result["tableCounts"]["sqlite_sequence"])
            self.assertEqual(
                sorted(probe.COLMAP_DATABASE_TABLES | {"sqlite_sequence"}),
                sorted(result["tableCounts"]),
            )

    def test_rejects_rollback_journal_and_nonempty_wal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for suffix, contents, expected_code in (
                ("-journal", b"", "SQLITE_ROLLBACK_JOURNAL_PRESENT"),
                ("-wal", b"not-empty", "NONEMPTY_SQLITE_WAL"),
            ):
                with self.subTest(suffix=suffix):
                    path = root / f"database{suffix.replace('-', '_')}.db"
                    create_colmap_database(path)
                    Path(str(path) + suffix).write_bytes(contents)
                    with self.assertRaises(probe.ProbeError) as caught:
                        probe.inspect_colmap_database(path)
                    self.assertEqual(expected_code, caught.exception.code)

    def test_rejects_unexpected_tables_views_and_triggers(self) -> None:
        cases = (
            ("CREATE TABLE surprise(value INTEGER);", "unexpected SQLite table surprise"),
            ("CREATE VIEW camera_view AS SELECT * FROM cameras;", "SQLite views are forbidden"),
            (
                "CREATE TRIGGER camera_trigger AFTER INSERT ON cameras BEGIN SELECT 1; END;",
                "SQLite triggers are forbidden",
            ),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index, (extra_sql, expected) in enumerate(cases):
                with self.subTest(expected=expected):
                    path = root / f"case-{index}.db"
                    create_colmap_database(path, extra_sql)
                    with self.assertRaisesRegex(probe.ProbeError, expected):
                        probe.inspect_colmap_database(path)

    def test_bounds_database_size_schema_objects_and_table_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "database.db"
            create_colmap_database(path)
            with patch.object(probe, "MAX_COLMAP_DATABASE_BYTES", 1):
                with self.assertRaisesRegex(probe.ProbeError, "database.db exceeds"):
                    probe.inspect_colmap_database(path)
            with patch.object(probe, "MAX_SQLITE_SCHEMA_OBJECTS", 1):
                with self.assertRaisesRegex(probe.ProbeError, "schema object count exceeds"):
                    probe.inspect_colmap_database(path)
            with patch.dict(probe.SQLITE_TABLE_ROW_LIMITS, {"images": 0}):
                with self.assertRaisesRegex(probe.ProbeError, "images row count exceeds 0"):
                    probe.inspect_colmap_database(path)

    def test_bounds_sparse_binary_and_jpeg_file_reads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = write_bytes(root, "cameras.bin", struct.pack("<Q", 0))
            with patch.object(probe, "MAX_COLMAP_BINARY_BYTES", 4):
                with self.assertRaisesRegex(probe.ProbeError, "cameras.bin exceeds"):
                    probe.parse_cameras_binary(binary)
            jpeg = write_bytes(root, "image.jpg", jpeg_bytes())
            with patch.object(probe, "MAX_JPEG_BYTES", 4):
                with self.assertRaisesRegex(probe.ProbeError, "image.jpg exceeds"):
                    probe.parse_jpeg_file(jpeg)

    def test_fake_e57_dependency_injection_and_canonical_envelope(self) -> None:
        inspected = probe.inspect_e57_metadata(
            Path("does-not-exist.e57"), FakeE57Adapter([[1.0, 2.0, 3.0]])
        )
        self.assertEqual("fake-e57", inspected["adapter"]["name"])
        self.assertFalse(inspected["pointDataRead"])
        self.assertEqual(np.__version__, inspected["runtimeVersions"]["numpy"])
        self.assertRegex(inspected["runtimeVersions"]["python"], r"^[0-9]+\.[0-9]+\.[0-9]+$")
        line = probe.canonical_json_line(
            {
                "status": "ok",
                "schemaVersion": probe.SCHEMA_VERSION,
                "mode": "inspect-e57",
                "result": inspected,
            }
        )
        self.assertEqual(line, probe.canonical_json_line(__import__("json").loads(line)))
        self.assertTrue(line.endswith("\n"))


if __name__ == "__main__":
    unittest.main()
