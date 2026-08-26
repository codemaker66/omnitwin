from __future__ import annotations

import ast
from contextlib import redirect_stderr
from dataclasses import replace
import hashlib
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from e57_image2d_evidence import (
    EvidenceProfile,
    GRAND_HALL_PROFILE,
    Image2DInput,
    MANIFEST_NAME,
    RECEIPT_NAME,
    canonical_json_bytes,
)
from extract_e57_image2d_evidence import (
    Pye57EvidenceSource,
    _require_safe_profile_output,
    main,
    run_check,
    run_extract,
)


def jpeg_fixture() -> bytes:
    stream = BytesIO()
    Image.new("RGB", (8, 8), (14, 37, 81)).save(stream, "JPEG", quality=90)
    return stream.getvalue()


class FakeSource:
    def __init__(
        self,
        guids: list[str],
        images: list[Image2DInput],
        drift_path: Path | None = None,
    ) -> None:
        self.guids = guids
        self.images = images
        self.drift_path = drift_path
        self.closed = False

    def data3d_guids(self) -> list[str]:
        return list(self.guids)

    def iter_images(self):
        yield from self.images

    def close(self) -> None:
        if self.drift_path is not None and not self.closed:
            content = self.drift_path.read_bytes()
            self.drift_path.write_bytes(bytes([content[0] ^ 1]) + content[1:])
        self.closed = True


class NodeStub:
    def __init__(self, defined: set[str]) -> None:
        self.defined = defined

    def isDefined(self, name: str) -> bool:
        return name in self.defined


class ExtractE57Image2DEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_root = os.environ.get("E57_EVIDENCE_TEST_TMP")
        self.temporary = tempfile.TemporaryDirectory(dir=temporary_root)
        self.root = Path(self.temporary.name)
        self.stage = self.root / "stage"
        self.e57 = self.stage / "source" / "e57" / "cloud_0.e57"
        self.e57.parent.mkdir(parents=True)
        self.source_bytes = b"small-E57-fixture"
        self.e57.write_bytes(self.source_bytes)
        self.source_sha256 = hashlib.sha256(self.source_bytes).hexdigest()
        self.jpeg = jpeg_fixture()
        self.profile = EvidenceProfile(
            expected_e57_sha256=self.source_sha256,
            expected_e57_size_bytes=len(self.source_bytes),
            data3d_count=2,
            image2d_count=12,
            faces_per_data3d=6,
            width=8,
            height=8,
            expected_aggregate_bytes=12 * len(self.jpeg),
            maximum_blob_bytes=1024 * 1024,
            maximum_aggregate_bytes=1024 * 1024,
        )
        self._write_stage_manifest()
        self.created_sources: list[FakeSource] = []

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write_stage_manifest(self) -> None:
        manifest = {
            "schemaVersion": "venviewer.capture-stage.v1",
            "sourceRoot": "X:/redacted-owned-capture",
            "planSha256": "a" * 64,
            "fileCount": 1,
            "totalBytes": len(self.source_bytes),
            "files": [
                {
                    "sourceRelativePath": "cloud_0.e57",
                    "targetRelativePath": "source/e57/cloud_0.e57",
                    "sizeBytes": len(self.source_bytes),
                    "sha256": self.source_sha256,
                    "role": "primary_capture",
                }
            ],
        }
        (self.stage / "capture-stage-manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )

    def _images(self) -> list[Image2DInput]:
        result: list[Image2DInput] = []
        for image_index in range(12):
            scan_index, face_index = divmod(image_index, 6)
            result.append(
                Image2DInput(
                    image_index=image_index,
                    image_guid=f"image-{image_index}",
                    image_name=f"Skybox {face_index}",
                    associated_data3d_guid=f"scan-{scan_index}",
                    representation_name="pinholeRepresentation",
                    blob_name="jpegImage",
                    width=8,
                    height=8,
                    focal_length=0.5,
                    pixel_width=0.125,
                    pixel_height=0.125,
                    principal_point_x=4.0,
                    principal_point_y=4.0,
                    jpeg_bytes=self.jpeg,
                )
            )
        return result

    def _factory(self, _path: Path, _profile: EvidenceProfile) -> FakeSource:
        source = FakeSource(["scan-0", "scan-1"], self._images())
        self.created_sources.append(source)
        return source

    def test_extract_then_check_hashes_and_decodes_the_complete_pack(self) -> None:
        output = self.root / "output"
        extracted = run_extract(self.stage, output, self.profile, self._factory)
        checked = run_check(self.stage, output, self.profile, self._factory)
        self.assertEqual(extracted, checked)
        self.assertTrue(self.created_sources[0].closed)
        self.assertEqual(checked["summary"]["image2DCount"], 12)

    def test_source_drift_prevents_terminal_publication(self) -> None:
        output = self.root / "drift-output"

        def factory(_path: Path, _profile: EvidenceProfile) -> FakeSource:
            source = FakeSource(["scan-0", "scan-1"], self._images(), self.e57)
            self.created_sources.append(source)
            return source

        with self.assertRaisesRegex(ValueError, "identity changed"):
            run_extract(self.stage, output, self.profile, factory)
        self.assertFalse(output.exists())
        self.assertTrue(self.created_sources[0].closed)

    def test_image_failure_closes_source_and_leaves_no_output(self) -> None:
        output = self.root / "bad-image-output"
        images = self._images()
        images[0] = replace(images[0], associated_data3d_guid="not-a-scan")

        def factory(_path: Path, _profile: EvidenceProfile) -> FakeSource:
            source = FakeSource(["scan-0", "scan-1"], images)
            self.created_sources.append(source)
            return source

        with self.assertRaisesRegex(ValueError, "does not bind"):
            run_extract(self.stage, output, self.profile, factory)
        self.assertFalse(output.exists())
        self.assertTrue(self.created_sources[0].closed)

    def test_check_rejects_tampered_receipt(self) -> None:
        output = self.root / "receipt-output"
        run_extract(self.stage, output, self.profile, self._factory)
        receipt = output / RECEIPT_NAME
        changed = receipt.read_bytes().replace(
            b'"publicationComplete": true',
            b'"publicationComplete": false',
        )
        receipt.write_bytes(changed)
        with self.assertRaisesRegex(ValueError, "receipt"):
            run_check(self.stage, output, self.profile, self._factory)

    def test_check_rederives_native_e57_metadata_and_blob_lineage(self) -> None:
        output = self.root / "forged-native-metadata"
        run_extract(self.stage, output, self.profile, self._factory)
        manifest_path = output / MANIFEST_NAME
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["images"][0]["imageGuid"] = "forged-image-guid"
        manifest_content = canonical_json_bytes(manifest)
        manifest_path.write_bytes(manifest_content)
        receipt_path = output / RECEIPT_NAME
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["manifest"]["sizeBytes"] = len(manifest_content)
        receipt["manifest"]["sha256"] = hashlib.sha256(manifest_content).hexdigest()
        receipt_path.write_bytes(canonical_json_bytes(receipt))
        with self.assertRaisesRegex(ValueError, "exact staged E57 Image2D"):
            run_check(self.stage, output, self.profile, self._factory)

    @unittest.skipUnless(os.name == "nt", "Grand Hall drive policy is Windows-specific")
    def test_grand_hall_profile_rejects_the_system_drive(self) -> None:
        with self.assertRaisesRegex(ValueError, "system C: drive"):
            run_extract(self.stage, Path("C:/unsafe-e57-evidence-output"))

    @unittest.skipUnless(os.name == "nt", "Grand Hall drive policy is Windows-specific")
    def test_grand_hall_profile_rejects_extended_device_paths(self) -> None:
        with self.assertRaisesRegex(ValueError, "ordinary local drive-letter"):
            _require_safe_profile_output(
                Path(r"\\?\C:\unsafe-e57-evidence-output"), GRAND_HALL_PROFILE
            )

    def test_cli_requires_explicit_full_hash_acknowledgement(self) -> None:
        stderr = StringIO()
        with redirect_stderr(stderr):
            with self.assertRaises(SystemExit) as raised:
                main(["--stage", str(self.stage), "--out", str(self.root / "unused")])
        self.assertEqual(raised.exception.code, 2)

    def test_pye57_boundary_rejects_non_pinhole_or_multiple_blobs(self) -> None:
        spherical = NodeStub({"sphericalRepresentation"})
        with self.assertRaisesRegex(ValueError, "representations"):
            Pye57EvidenceSource._representation_name(spherical, 0)
        multiple = NodeStub({"jpegImage", "pngImage"})
        with self.assertRaisesRegex(ValueError, "blobs"):
            Pye57EvidenceSource._blob_name(multiple, 0)

    def test_core_has_no_pye57_dependency(self) -> None:
        core = Path(__file__).parents[1] / "e57_image2d_evidence.py"
        tree = ast.parse(core.read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            if isinstance(node, ast.ImportFrom) and node.module is not None:
                imported.add(node.module)
        self.assertNotIn("pye57", imported)


if __name__ == "__main__":
    unittest.main()
