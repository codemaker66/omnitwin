from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from e57_stage_guard import (
    LIDAR_TRUTH_SCHEMA_VERSION,
    assert_disjoint_output,
    load_stage,
    load_truth_panos,
    verify_stage_file,
    verify_truth_panos,
)


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class E57StageGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.stage = self.root / "stage"
        self.e57 = self.stage / "source" / "e57" / "cloud_0.e57"
        self.e57.parent.mkdir(parents=True)
        self.e57_bytes = b"ASTM-E57-test-fixture"
        self.e57.write_bytes(self.e57_bytes)
        self.manifest = {
            "schemaVersion": "venviewer.capture-stage.v1",
            "sourceRoot": "X:/immutable-source",
            "planSha256": "a" * 64,
            "fileCount": 1,
            "totalBytes": len(self.e57_bytes),
            "files": [
                {
                    "sourceRelativePath": "cloud_0.e57",
                    "targetRelativePath": "source/e57/cloud_0.e57",
                    "sizeBytes": len(self.e57_bytes),
                    "sha256": digest(self.e57_bytes),
                    "role": "primary_capture",
                }
            ],
        }
        (self.stage / "capture-stage-manifest.json").write_text(
            json.dumps(self.manifest), encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def make_truth(self, provenance_status: str = "regenerated_from_staged_e57") -> tuple[Path, Path]:
        truth = self.root / "truth"
        truth.mkdir()
        pano = truth / "scan_000.jpg"
        content = b"deterministic-pano-fixture"
        pano.write_bytes(content)
        manifest = {
            "schemaVersion": LIDAR_TRUTH_SCHEMA_VERSION,
            "provenanceStatus": provenance_status,
            "sourceE57Sha256": digest(self.e57_bytes),
            "sourceE57SizeBytes": len(self.e57_bytes),
            "generator": {
                "name": "fixture-generator",
                "version": "1.0.0",
                "parametersSha256": "b" * 64,
            },
            "panos": [
                {
                    "scanIndex": 0,
                    "relativePath": "scan_000.jpg",
                    "sizeBytes": len(content),
                    "sha256": digest(content),
                    "width": 16,
                    "height": 8,
                }
            ],
        }
        manifest_path = truth / "truth-manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        return truth, manifest_path

    def test_accepts_a_complete_hash_anchored_stage_and_truth_set(self) -> None:
        stage = load_stage(self.stage)
        verify_stage_file(stage.primary_e57)
        truth_root, manifest_path = self.make_truth()
        truth = load_truth_panos(stage, truth_root, manifest_path)
        verify_truth_panos(truth, [0])
        self.assertEqual(stage.primary_e57.sha256, digest(self.e57_bytes))
        self.assertEqual(truth.panos[0].relative_path, "scan_000.jpg")

    def test_rejects_output_in_either_direction_of_source_overlap(self) -> None:
        stage = load_stage(self.stage)
        with self.assertRaisesRegex(ValueError, "overlaps protected source"):
            assert_disjoint_output(self.stage / "derived", [stage.root])
        with self.assertRaisesRegex(ValueError, "overlaps protected source"):
            assert_disjoint_output(self.root, [stage.root])

    def test_rejects_old_or_unprovenanced_truth_panos(self) -> None:
        stage = load_stage(self.stage)
        truth_root, manifest_path = self.make_truth("unknown_derived_workspace")
        with self.assertRaisesRegex(ValueError, "regenerated from the staged E57"):
            load_truth_panos(stage, truth_root, manifest_path)

    def test_rejects_a_stage_path_escape_even_when_the_target_exists(self) -> None:
        outside = self.root / "outside.e57"
        outside.write_bytes(self.e57_bytes)
        self.manifest["files"][0]["targetRelativePath"] = "../outside.e57"
        (self.stage / "capture-stage-manifest.json").write_text(
            json.dumps(self.manifest), encoding="utf-8"
        )
        with self.assertRaisesRegex(ValueError, "canonical relative path"):
            load_stage(self.stage)

    def test_detects_truth_pano_digest_drift(self) -> None:
        stage = load_stage(self.stage)
        truth_root, manifest_path = self.make_truth()
        truth = load_truth_panos(stage, truth_root, manifest_path)
        (truth_root / "scan_000.jpg").write_bytes(b"different-but-same-no")
        with self.assertRaisesRegex(ValueError, "size drift|SHA-256 drift"):
            verify_truth_panos(truth, [0])

    def test_rejects_a_symlinked_stage_file(self) -> None:
        outside = self.root / "outside.e57"
        outside.write_bytes(self.e57_bytes)
        self.e57.unlink()
        try:
            self.e57.symlink_to(outside)
        except OSError as error:
            self.skipTest(f"symlink creation is unavailable: {error}")
        with self.assertRaisesRegex(ValueError, "symbolic link or reparse point"):
            load_stage(self.stage)

    def test_rejects_link_traversal_even_when_os_symlink_creation_is_unavailable(self) -> None:
        original = Path.is_symlink

        def reports_primary_as_link(path: Path) -> bool:
            if path.name == "cloud_0.e57":
                return True
            return original(path)

        with patch.object(Path, "is_symlink", autospec=True, side_effect=reports_primary_as_link):
            with self.assertRaisesRegex(ValueError, "symbolic link or reparse point"):
                load_stage(self.stage)

    def test_equirect_report_keeps_truth_provenance_separate_from_raster_copy(self) -> None:
        script = Path(__file__).parents[1] / "extract_equirect_v2.py"
        tree = ast.parse(script.read_text(encoding="utf-8"), filename=str(script))
        report_dicts = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Dict):
                continue
            if any(isinstance(target, ast.Name) and target.id == "report" for target in node.targets):
                report_dicts.append(node.value)
        matching = []
        for value in report_dicts:
            keys = [key.value for key in value.keys if isinstance(key, ast.Constant)]
            self.assertEqual(len(keys), len(set(keys)), "report literal must not contain duplicate keys")
            if {"source", "truth", "truthRasterConvention"}.issubset(keys):
                matching.append(value)
                truth_index = keys.index("truth")
                self.assertIsInstance(value.values[truth_index], ast.Name)
                self.assertEqual(value.values[truth_index].id, "truth_provenance")
        self.assertEqual(len(matching), 1)

    def test_legacy_entry_points_have_no_capture_drive_defaults(self) -> None:
        scripts = Path(__file__).parents[1]
        for name in (
            "extract_equirect.py",
            "extract_photos.py",
            "extract_photos_v3.py",
            "probe_images2d.py",
        ):
            source = (scripts / name).read_text(encoding="utf-8")
            self.assertNotIn("F:\\E57", source, name)
            self.assertNotIn("F:/E57", source, name)


if __name__ == "__main__":
    unittest.main()
