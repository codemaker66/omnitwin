from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "compare_matched_renders.py"
SPEC = importlib.util.spec_from_file_location("compare_matched_renders", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


SCAN_IDS = (131, 134, 138)


def room_pattern(scan_id: int, size: int = 96) -> np.ndarray:
    image = np.full((size, size, 3), 34, dtype=np.uint8)
    offset = (scan_id % 7) + 10
    image[12:84, 10:13] = 220
    image[18:21, 8:87] = 190
    image[75:79, 7:89] = 145
    image[20:78, offset : offset + 4] = 235
    image[42:46, 12:88] = 105
    image[24:72, 62:79] = 74
    image[25:71, 63:66] = 182
    return image


def shifted(image: np.ndarray, pixels: int) -> np.ndarray:
    result = np.full_like(image, 34)
    result[:, pixels:] = image[:, :-pixels]
    return result


def save_image(path: Path, pixels: np.ndarray, *, scale: int = 1) -> None:
    image = Image.fromarray(pixels, mode="RGB")
    if scale != 1:
        image = image.resize(
            (pixels.shape[1] * scale, pixels.shape[0] * scale),
            Image.Resampling.NEAREST,
        )
    image.save(path)


def write_manifest(
    root: Path,
    *,
    quality_images: dict[int, np.ndarray] | None = None,
    mobile_images: dict[int, np.ndarray] | None = None,
    quality_repeats: dict[int, np.ndarray] | None = None,
    mobile_repeats: dict[int, np.ndarray] | None = None,
    scan_ids: tuple[int, ...] = SCAN_IDS,
    border_pixels: int = 2,
    reference_scale: int = 2,
) -> Path:
    views: list[dict[str, object]] = []
    for index, scan_id in enumerate(scan_ids):
        reference = room_pattern(scan_id)
        quality = (quality_images or {}).get(scan_id, reference)
        mobile = (mobile_images or {}).get(scan_id, shifted(reference, 8))
        prefix = f"{index}-{scan_id}"
        reference_path = root / f"{prefix}-reference.jpg"
        quality_path = root / f"{prefix}-quality.png"
        mobile_path = root / f"{prefix}-mobile.png"
        save_image(reference_path, reference, scale=reference_scale)
        save_image(quality_path, quality)
        save_image(mobile_path, mobile)
        quality_entry: dict[str, str] = {"render": quality_path.name}
        mobile_entry: dict[str, str] = {"render": mobile_path.name}
        if quality_repeats is not None:
            repeat_path = root / f"{prefix}-quality-repeat.png"
            save_image(repeat_path, quality_repeats[scan_id])
            quality_entry["repeat"] = repeat_path.name
        if mobile_repeats is not None:
            repeat_path = root / f"{prefix}-mobile-repeat.png"
            save_image(repeat_path, mobile_repeats[scan_id])
            mobile_entry["repeat"] = repeat_path.name
        views.append(
            {
                "scanId": scan_id,
                "reference": reference_path.name,
                "quality": quality_entry,
                "mobile": mobile_entry,
            }
        )
    manifest = {
        "schemaVersion": MODULE.INPUT_SCHEMA_VERSION,
        "authority": "none",
        "comparison": {
            "width": 96,
            "height": 96,
            "borderPixels": border_pixels,
        },
        "views": views,
    }
    manifest_path = root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest_path


class MetricTests(unittest.TestCase):
    def test_metrics_are_structural_and_exposure_resistant(self) -> None:
        reference = room_pattern(131)
        brighter = np.clip(reference.astype(np.float64) * 0.72 + 55.0, 0, 255).astype(np.uint8)
        different = shifted(reference, 9)

        same_structure = MODULE.compare_arrays(reference, brighter, border_pixels=2)
        moved_structure = MODULE.compare_arrays(reference, different, border_pixels=2)

        self.assertLess(
            same_structure["multiscaleEdgeChamfer"],
            moved_structure["multiscaleEdgeChamfer"],
        )
        self.assertGreater(
            same_structure["normalizedGradientOrientationSimilarity"],
            moved_structure["normalizedGradientOrientationSimilarity"],
        )

    def test_metric_rejects_blank_input(self) -> None:
        blank = np.full((96, 96, 3), 80, dtype=np.uint8)
        with self.assertRaisesRegex(MODULE.ComparisonError, "BLANK_IMAGE"):
            MODULE.compare_arrays(blank, room_pattern(131), border_pixels=2)

    def test_metric_rejects_dimensions_that_would_drop_multiscale_pixels(self) -> None:
        image = room_pattern(131)[:, :-1]
        with self.assertRaisesRegex(MODULE.ComparisonError, "divisible"):
            MODULE.compare_arrays(image, image.copy(), border_pixels=2)

    def test_winner_uses_sub_nanoround_full_precision(self) -> None:
        winner, margin = MODULE._metric_winner(
            "multiscaleEdgeChamfer", 0.1000000004, 0.1000000008
        )
        self.assertEqual(winner, "quality")
        self.assertGreater(margin, MODULE.NUMERIC_TOLERANCE)


class ManifestEvaluationTests(unittest.TestCase):
    def test_quality_gets_directional_lead_on_both_metrics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            references = {scan_id: room_pattern(scan_id) for scan_id in SCAN_IDS}
            manifest = write_manifest(
                root,
                quality_repeats=references,
                mobile_repeats={
                    scan_id: shifted(references[scan_id], 8) for scan_id in SCAN_IDS
                },
            )

            report = MODULE.evaluate_manifest(manifest)

            self.assertEqual(report["authority"], "none")
            self.assertEqual(report["decision"]["status"], "directional_lead")
            self.assertEqual(report["decision"]["candidate"], "quality")
            self.assertFalse(report["decision"]["isPhysicalApproval"])
            self.assertIsNone(report["decision"]["isPracticallyMaterial"])
            self.assertEqual(
                report["decision"]["practicalMaterialityAssessment"], "not_calibrated"
            )
            self.assertIn(
                "multiscaleEdgeChamfer", report["decision"]["aggregateEffectSizes"]
            )
            self.assertEqual(
                report["decision"]["clearWinCounts"]["quality"],
                {
                    "multiscaleEdgeChamfer": 3,
                    "normalizedGradientOrientationSimilarity": 3,
                },
            )
            self.assertEqual(
                [row["scanId"] for row in report["views"]],
                list(SCAN_IDS),
            )
            for row in report["views"]:
                self.assertEqual(row["reference"]["originalDimensions"], [192, 192])
                self.assertEqual(row["reference"]["comparisonDimensions"], [96, 96])
                self.assertEqual(len(row["reference"]["sha256"]), 64)

    def test_missing_repeats_run_but_cannot_produce_a_lead(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest = write_manifest(Path(temporary))

            report = MODULE.evaluate_manifest(manifest)

            self.assertEqual(report["decision"]["status"], "no_reliable_winner")
            self.assertIsNone(report["decision"]["candidate"])
            self.assertIn("common repeat evidence", " ".join(report["decision"]["reasons"]))

    def test_repeat_noise_can_block_an_apparent_win(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            references = {scan_id: room_pattern(scan_id) for scan_id in SCAN_IDS}
            quality_main = {
                scan_id: shifted(references[scan_id], 2) for scan_id in SCAN_IDS
            }
            mobile_main = {
                scan_id: shifted(references[scan_id], 6) for scan_id in SCAN_IDS
            }
            manifest = write_manifest(
                root,
                quality_images=quality_main,
                mobile_images=mobile_main,
                quality_repeats={
                    scan_id: shifted(references[scan_id], 14) for scan_id in SCAN_IDS
                },
                mobile_repeats=mobile_main,
            )

            report = MODULE.evaluate_manifest(manifest)

            self.assertEqual(report["decision"]["status"], "no_reliable_winner")
            self.assertTrue(
                any("repeat noise" in reason for reason in report["decision"]["reasons"])
            )

    def test_exact_scan_firewall_rejects_missing_extra_and_duplicate_ids(self) -> None:
        cases = (
            ((131, 134), "missing"),
            ((131, 134, 138, 126), "frozen"),
            ((131, 134, 138, 138), "duplicate"),
        )
        for scan_ids, expected_message in cases:
            with self.subTest(scan_ids=scan_ids), tempfile.TemporaryDirectory() as temporary:
                manifest = write_manifest(Path(temporary), scan_ids=scan_ids)
                with self.assertRaisesRegex(MODULE.ComparisonError, expected_message):
                    MODULE.evaluate_manifest(manifest)

    def test_rejects_wrong_authority_blank_and_aspect_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = write_manifest(root)
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload["authority"] = "reviewed"
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ComparisonError, "AUTHORITY"):
                MODULE.evaluate_manifest(manifest)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = write_manifest(root)
            blank_path = root / "blank.png"
            save_image(blank_path, np.full((96, 96, 3), 70, dtype=np.uint8))
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload["views"][0]["quality"]["render"] = blank_path.name
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ComparisonError, "BLANK_IMAGE"):
                MODULE.evaluate_manifest(manifest)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = write_manifest(root)
            wrong_shape = root / "wrong-shape.png"
            save_image(wrong_shape, np.full((96, 80, 3), 90, dtype=np.uint8))
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload["views"][0]["quality"]["render"] = wrong_shape.name
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ComparisonError, "ASPECT_RATIO_MISMATCH"):
                MODULE.evaluate_manifest(manifest)

    def test_rejects_duplicate_json_keys_and_duplicate_source_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "manifest.json"
            manifest.write_text(
                '{"schemaVersion":"a","schemaVersion":"b"}', encoding="utf-8"
            )
            with self.assertRaisesRegex(MODULE.ComparisonError, "DUPLICATE_JSON_KEY"):
                MODULE.evaluate_manifest(manifest)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = write_manifest(root)
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload["views"][0]["mobile"]["render"] = payload["views"][0]["quality"][
                "render"
            ]
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(MODULE.ComparisonError, "DUPLICATE_INPUT_PATH"):
                MODULE.evaluate_manifest(manifest)

    def test_receipt_is_deterministic_and_create_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            references = {scan_id: room_pattern(scan_id) for scan_id in SCAN_IDS}
            manifest = write_manifest(
                root,
                quality_repeats=references,
                mobile_repeats={
                    scan_id: shifted(references[scan_id], 8) for scan_id in SCAN_IDS
                },
            )
            first = MODULE.evaluate_manifest(manifest)
            second = MODULE.evaluate_manifest(manifest)
            self.assertEqual(first, second)
            self.assertEqual(len(first["receipt"]["sha256"]), 64)

            output = root / "receipt.json"
            written = MODULE.run(manifest, output)
            self.assertEqual(written, first)
            self.assertEqual(
                json.loads(output.read_text(encoding="utf-8")), first
            )
            with self.assertRaisesRegex(MODULE.ComparisonError, "OUTPUT_EXISTS"):
                MODULE.run(manifest, output)

    def test_optional_contact_sheet_is_labeled_bound_and_create_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            references = {scan_id: room_pattern(scan_id) for scan_id in SCAN_IDS}
            manifest = write_manifest(
                root,
                quality_repeats=references,
                mobile_repeats={
                    scan_id: shifted(references[scan_id], 8) for scan_id in SCAN_IDS
                },
            )
            output = root / "receipt.json"
            contact_sheet = root / "contact-sheet.png"

            report = MODULE.run(manifest, output, contact_sheet)

            self.assertTrue(contact_sheet.is_file())
            with Image.open(contact_sheet) as image:
                self.assertEqual(image.format, "PNG")
                self.assertGreater(image.width, image.height // 2)
            self.assertEqual(report["contactSheet"]["path"], str(contact_sheet))
            self.assertEqual(
                report["contactSheet"]["sha256"],
                MODULE._sha256_bytes(contact_sheet.read_bytes()),
            )
            self.assertEqual(
                report["contactSheet"]["layout"]["rows"], list(SCAN_IDS)
            )
            self.assertFalse(report["contactSheet"]["isPhysicalApproval"])

            second_output = root / "second-receipt.json"
            with self.assertRaisesRegex(MODULE.ComparisonError, "OUTPUT_EXISTS"):
                MODULE.run(manifest, second_output, contact_sheet)
            self.assertFalse(second_output.exists())


if __name__ == "__main__":
    unittest.main()
