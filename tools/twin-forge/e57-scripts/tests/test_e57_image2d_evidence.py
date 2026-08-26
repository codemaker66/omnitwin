from __future__ import annotations

import ast
from dataclasses import replace
import hashlib
from io import BytesIO
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

import e57_image2d_evidence as evidence
from e57_image2d_evidence import (
    CaptureIdentity,
    EvidenceProfile,
    MANIFEST_NAME,
    RECEIPT_NAME,
    Image2DInput,
    build_manifest,
    build_receipt,
    canonical_json_bytes,
    publication_stage,
    validate_record_set,
    verify_evidence_pack,
    write_image_record,
    write_manifest,
    write_receipt_last,
)
from extract_e57_image2d_evidence import decode_jpeg_with_pillow


def jpeg_fixture(width: int = 8, height: int = 8) -> bytes:
    stream = BytesIO()
    Image.new("RGB", (width, height), (72, 41, 19)).save(stream, "JPEG", quality=91)
    return stream.getvalue()


class E57Image2DEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_root = os.environ.get("E57_EVIDENCE_TEST_TMP")
        self.temporary = tempfile.TemporaryDirectory(dir=temporary_root)
        self.root = Path(self.temporary.name)
        self.jpeg = jpeg_fixture()
        self.source_bytes = b"small-E57-fixture"
        self.profile = EvidenceProfile(
            expected_e57_sha256=hashlib.sha256(self.source_bytes).hexdigest(),
            expected_e57_size_bytes=len(self.source_bytes),
            data3d_count=2,
            image2d_count=12,
            faces_per_data3d=6,
            width=8,
            height=8,
            expected_aggregate_bytes=12 * len(self.jpeg),
            maximum_blob_bytes=1024 * 1024,
            maximum_aggregate_bytes=12 * len(self.jpeg),
        )
        self.identity = CaptureIdentity(
            capture_stage_plan_sha256="a" * 64,
            e57_target_relative_path="source/e57/cloud_0.e57",
            e57_size_bytes=len(self.source_bytes),
            e57_sha256=self.profile.expected_e57_sha256,
        )
        self.guids = ["scan-guid-0", "scan-guid-1"]

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def images(self) -> list[Image2DInput]:
        result: list[Image2DInput] = []
        for image_index in range(12):
            scan_index, face_index = divmod(image_index, 6)
            result.append(
                Image2DInput(
                    image_index=image_index,
                    image_guid=f"image-guid-{image_index}",
                    image_name=f"Skybox {face_index}",
                    associated_data3d_guid=self.guids[scan_index],
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

    def publish(self, output: Path, images: list[Image2DInput] | None = None) -> dict:
        selected = images if images is not None else self.images()
        by_guid = {guid: index for index, guid in enumerate(self.guids)}
        with publication_stage(output) as temporary:
            records = [
                write_image_record(
                    temporary, image, by_guid, self.profile, decode_jpeg_with_pillow
                )
                for image in selected
            ]
            manifest = build_manifest(self.identity, self.guids, records, self.profile)
            size, digest = write_manifest(temporary, manifest)
            write_receipt_last(
                temporary,
                build_receipt(self.identity, size, digest, records),
            )
            verify_evidence_pack(
                temporary, self.identity, self.profile, decode_jpeg_with_pillow
            )
        return manifest

    def test_publishes_and_strictly_rechecks_a_byte_exact_pack(self) -> None:
        output = self.root / "pack"
        manifest = self.publish(output)
        checked = verify_evidence_pack(
            output, self.identity, self.profile, decode_jpeg_with_pillow
        )
        self.assertEqual(checked, manifest)
        self.assertEqual(checked["summary"]["image2DCount"], 12)
        self.assertEqual(checked["contract"]["roomMembershipAuthority"], "none")

    def test_publication_is_deterministic_and_no_replace(self) -> None:
        first = self.root / "first"
        second = self.root / "second"
        self.publish(first)
        self.publish(second)
        self.assertEqual(
            (first / MANIFEST_NAME).read_bytes(),
            (second / MANIFEST_NAME).read_bytes(),
        )
        self.assertEqual((first / RECEIPT_NAME).read_bytes(), (second / RECEIPT_NAME).read_bytes())
        with self.assertRaisesRegex(ValueError, "refusing to replace"):
            self.publish(first)

    def test_rejects_unknown_association_without_publishing(self) -> None:
        images = self.images()
        images[0] = replace(images[0], associated_data3d_guid="unknown-guid")
        output = self.root / "unknown-association"
        with self.assertRaisesRegex(ValueError, "does not bind"):
            self.publish(output, images)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob(".unknown-association.stage-*")), [])

    def test_rejects_duplicate_image_guid_and_missing_face(self) -> None:
        duplicate = self.images()
        duplicate[1] = replace(duplicate[1], image_guid=duplicate[0].image_guid)
        with self.assertRaisesRegex(ValueError, "GUIDs must be unique"):
            self.publish(self.root / "duplicate", duplicate)
        missing = self.images()[:-1]
        with self.assertRaisesRegex(ValueError, "expected 12 Image2D"):
            self.publish(self.root / "missing", missing)

    def test_rejects_duplicate_data3d_guid_and_repeated_face(self) -> None:
        records = self._records_without_publication(self.root / "duplicate-data3d", self.profile)
        with self.assertRaisesRegex(ValueError, "Data3D GUIDs must be unique"):
            validate_record_set(records, [self.guids[0], self.guids[0]], self.profile)
        images = self.images()
        images[-1] = replace(images[-1], image_name="Skybox 4")
        with self.assertRaisesRegex(ValueError, "every Skybox face"):
            self.publish(self.root / "repeated-face", images)

    def test_rejects_noncanonical_zero_padded_skybox_name(self) -> None:
        images = self.images()
        images[0] = replace(images[0], image_name="Skybox 00")
        with self.assertRaisesRegex(ValueError, "unexpected Image2D name"):
            self.publish(self.root / "zero-padded-face", images)

    def test_rejects_wrong_representation_dimensions_and_intrinsics(self) -> None:
        cases = (
            ("pinholeRepresentation", {"representation_name": "sphericalRepresentation"}),
            ("dimensions", {"width": 7}),
            ("principal point", {"principal_point_x": 99.0}),
        )
        for expected, fields in cases:
            with self.subTest(expected=expected):
                images = self.images()
                images[0] = replace(images[0], **fields)
                with self.assertRaisesRegex(ValueError, expected):
                    self.publish(self.root / expected.replace(" ", "-"), images)

    def test_rejects_nonfinite_input_and_drifted_record_contract(self) -> None:
        images = self.images()
        images[0] = replace(images[0], focal_length=float("nan"))
        with self.assertRaisesRegex(ValueError, "finite"):
            self.publish(self.root / "nonfinite", images)
        records = self._records_without_publication(self.root / "record-contract", self.profile)
        records[0] = replace(records[0], representation="sphericalRepresentation")
        with self.assertRaisesRegex(ValueError, "contract drifted"):
            validate_record_set(records, self.guids, self.profile)

    def test_rejects_marker_only_and_truncated_jpegs(self) -> None:
        for name, content in (
            ("marker-only", b"\xff\xd8garbage\xff\xd9"),
            ("truncated", self.jpeg[: len(self.jpeg) // 2] + b"\xff\xd9"),
        ):
            with self.subTest(name=name):
                images = self.images()
                images[0] = replace(images[0], jpeg_bytes=content)
                with self.assertRaisesRegex(ValueError, "full decode"):
                    self.publish(self.root / name, images)

    def test_rejects_aggregate_bound_and_payload_drift(self) -> None:
        restrictive = replace(self.profile, maximum_aggregate_bytes=12 * len(self.jpeg) - 1)
        records = self._records_without_publication(self.root / "aggregate", restrictive)
        with self.assertRaisesRegex(ValueError, "aggregate"):
            validate_record_set(records, self.guids, restrictive)
        output = self.root / "drift"
        self.publish(output)
        image_path = next((output / "images").rglob("*.jpg"))
        image_path.write_bytes(self.jpeg[:-1] + b"x")
        with self.assertRaisesRegex(ValueError, "bytes drifted"):
            verify_evidence_pack(output, self.identity, self.profile, decode_jpeg_with_pillow)

    def test_rejects_json_boolean_number_coercion(self) -> None:
        output = self.root / "type-coercion"
        manifest = self.publish(output)
        manifest["source"]["sourceHashVerifiedBeforeExtraction"] = 1
        (output / MANIFEST_NAME).write_bytes(canonical_json_bytes(manifest))
        with self.assertRaisesRegex(ValueError, "exact verified capture stage"):
            verify_evidence_pack(output, self.identity, self.profile, decode_jpeg_with_pillow)

    def _records_without_publication(self, root: Path, profile: EvidenceProfile) -> list:
        root.mkdir()
        by_guid = {guid: index for index, guid in enumerate(self.guids)}
        return [
            write_image_record(root, image, by_guid, profile, decode_jpeg_with_pillow)
            for image in self.images()
        ]

    def test_rejects_extra_files_and_reported_links(self) -> None:
        output = self.root / "extra"
        self.publish(output)
        (output / "unexpected.txt").write_text("not evidence", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "missing or unexpected"):
            verify_evidence_pack(output, self.identity, self.profile, decode_jpeg_with_pillow)
        (output / "unexpected.txt").unlink()
        link = output / "linked.jpg"
        link.write_bytes(self.jpeg)
        original = evidence._is_link_or_reparse

        def reports_link(path: Path) -> bool:
            return path.name == "linked.jpg" or original(path)

        with patch.object(evidence, "_is_link_or_reparse", side_effect=reports_link):
            with self.assertRaisesRegex(ValueError, "linked"):
                verify_evidence_pack(
                    output, self.identity, self.profile, decode_jpeg_with_pillow
                )

    def test_rejects_files_added_during_verification(self) -> None:
        output = self.root / "concurrent-extra"
        self.publish(output)
        changed = False

        def decoder(content: bytes):
            nonlocal changed
            decoded = decode_jpeg_with_pillow(content)
            if not changed:
                (output / "unexpected-during-check.txt").write_text("race", encoding="utf-8")
                changed = True
            return decoded

        with self.assertRaisesRegex(ValueError, "inventory changed"):
            verify_evidence_pack(output, self.identity, self.profile, decoder)

    def test_rejects_payload_changed_after_its_verification_turn(self) -> None:
        output = self.root / "concurrent-payload"
        self.publish(output)
        target = output / "images/scan_000/image2d_000_skybox_0.jpg"
        changed = False

        def decoder(content: bytes):
            nonlocal changed
            decoded = decode_jpeg_with_pillow(content)
            if not changed:
                replacement = bytearray(target.read_bytes())
                replacement[-3] ^= 1
                target.write_bytes(replacement)
                changed = True
            return decoded

        with self.assertRaisesRegex(ValueError, "files changed"):
            verify_evidence_pack(output, self.identity, self.profile, decoder)

    def test_failed_transaction_leaves_no_output_or_receipt(self) -> None:
        output = self.root / "failed"
        with self.assertRaisesRegex(RuntimeError, "injected"):
            with publication_stage(output) as temporary:
                (temporary / "partial.bin").write_bytes(b"partial")
                raise RuntimeError("injected failure")
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob(".failed.stage-*")), [])

    def test_all_functions_respect_the_fifty_line_policy(self) -> None:
        draft = Path(__file__).parents[1]
        for name in ("e57_image2d_evidence.py", "extract_e57_image2d_evidence.py"):
            tree = ast.parse((draft / name).read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    length = (node.end_lineno or node.lineno) - node.lineno + 1
                    self.assertLessEqual(length, 50, f"{name}:{node.name} has {length} lines")


if __name__ == "__main__":
    unittest.main()
