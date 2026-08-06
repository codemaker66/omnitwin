from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from triage_fixed_views import (  # noqa: E402
    VIEWS,
    ImageShapeMismatch,
    analyze_rgb,
    build_report,
    verify_report_receipt,
)


def structured_image(size: int = 128) -> np.ndarray:
    image = np.full((size, size, 3), 0.08, dtype=np.float64)
    image[24:104, 30:36, :] = 0.9
    image[24:30, 30:98, :] = 0.9
    image[98:104, 30:98, :] = 0.9
    image[44:84, 58:92, 0] = 0.65
    image[44:84, 58:92, 1] = 0.35
    image[44:84, 58:92, 2] = 0.2
    return image


def write_pair_images(
    root: Path,
    baseline: np.ndarray,
    candidate: np.ndarray | None = None,
) -> None:
    candidate = baseline if candidate is None else candidate
    baseline_uint8 = (baseline * 255.0).astype(np.uint8)
    candidate_uint8 = (candidate * 255.0).astype(np.uint8)
    for view in VIEWS:
        Image.fromarray(baseline_uint8, mode="RGB").save(
            root / f"matrix-{view}-baseline.png"
        )
        Image.fromarray(candidate_uint8, mode="RGB").save(
            root / f"matrix-{view}-candidate.png"
        )


class FixedViewCvTriageTests(unittest.TestCase):
    def test_exact_structured_match_is_triage_clear(self) -> None:
        baseline = structured_image()

        result = analyze_rgb(baseline, baseline.copy())

        self.assertEqual(result["verdict"], "triage_clear")
        self.assertEqual(result["triggeredSignals"], [])
        self.assertEqual(result["metrics"]["missingEdgeFraction"], 0.0)
        self.assertEqual(result["metrics"]["extraEdgeFraction"], 0.0)
        self.assertIn("not acceptance", result["meaning"])

    def test_shifted_doubled_edges_require_review(self) -> None:
        baseline = structured_image()
        shifted = np.roll(baseline, 6, axis=1)
        candidate = 0.5 * baseline + 0.5 * shifted

        result = analyze_rgb(baseline, candidate)

        self.assertEqual(result["verdict"], "review")
        self.assertTrue(result["flags"]["parallelNearbyEdges"])
        self.assertGreater(result["metrics"]["parallelNearbyEdgeFraction"], 0.28)

    def test_faint_six_pixel_ghost_requires_local_multiscale_review(self) -> None:
        baseline = structured_image()
        candidate = 0.8 * baseline + 0.2 * np.roll(baseline, 6, axis=1)

        result = analyze_rgb(baseline, candidate)

        self.assertEqual(result["verdict"], "review")
        self.assertTrue(result["flags"]["localMultiscaleRegression"])
        self.assertIn(
            "multiscale_detail_loss", result["localMultiscale"]["reasons"]
        )

    def test_five_percent_local_occlusion_requires_review(self) -> None:
        baseline = structured_image()
        candidate = baseline.copy()
        height, width, _ = candidate.shape
        side = int((height * width * 0.05) ** 0.5)
        y0 = (height - side) // 2
        x0 = (width - side) // 2
        candidate[y0 : y0 + side, x0 : x0 + side, :] = 0.0

        result = analyze_rgb(baseline, candidate)

        self.assertEqual(result["verdict"], "review")
        self.assertTrue(result["flags"]["localMultiscaleRegression"])
        self.assertIn("local_pixel_drift", result["localMultiscale"]["reasons"])

    def test_sigma_one_blur_requires_local_multiscale_review(self) -> None:
        baseline = structured_image()
        candidate = gaussian_filter(baseline, sigma=(1.0, 1.0, 0.0))

        result = analyze_rgb(baseline, candidate)

        self.assertEqual(result["verdict"], "review")
        self.assertTrue(result["flags"]["localMultiscaleRegression"])
        self.assertIn(
            "multiscale_detail_loss", result["localMultiscale"]["reasons"]
        )

    def test_missing_edges_require_review(self) -> None:
        baseline = structured_image()
        candidate = np.full_like(baseline, 0.08)

        result = analyze_rgb(baseline, candidate)

        self.assertEqual(result["verdict"], "review")
        self.assertTrue(result["flags"]["missingEdges"])
        self.assertEqual(result["metrics"]["missingEdgeFraction"], 1.0)
        self.assertIsNone(
            result["metrics"]["baselineToCandidateEdgeDistanceP95Pixels"]
        )

    def test_gross_colour_drift_requires_review(self) -> None:
        baseline = structured_image()
        candidate = np.clip(baseline + 0.1, 0.0, 1.0)

        result = analyze_rgb(baseline, candidate)

        self.assertEqual(result["verdict"], "review")
        self.assertTrue(result["flags"]["grossPixelDrift"])
        self.assertTrue(result["flags"]["meanColorDrift"])

    def test_flat_image_is_not_treated_as_quality_evidence(self) -> None:
        flat = np.full((128, 128, 3), 0.5, dtype=np.float64)

        result = analyze_rgb(flat, flat.copy())

        self.assertEqual(result["verdict"], "not_assessable")
        self.assertFalse(result["assessability"]["assessable"])

    def test_noise_is_not_treated_as_quality_evidence(self) -> None:
        rng = np.random.default_rng(20260713)
        noise = rng.random((128, 128, 3), dtype=np.float64)

        result = analyze_rgb(noise, noise.copy())

        self.assertEqual(result["verdict"], "not_assessable")
        self.assertFalse(result["assessability"]["assessable"])

    def test_mismatched_dimensions_fail_closed(self) -> None:
        baseline = structured_image(128)
        candidate = structured_image(96)

        with self.assertRaises(ImageShapeMismatch):
            analyze_rgb(baseline, candidate)

    def test_report_contains_basenames_but_not_caller_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            write_pair_images(root, structured_image())

            report = build_report(root, (("baseline", "candidate"),))
            serialized = json.dumps(report, allow_nan=False)

        self.assertNotIn(temporary_root, serialized)
        self.assertIn("matrix-overview-baseline.png", serialized)
        self.assertEqual(report["resultType"], "regression_triage_not_acceptance")
        self.assertEqual(
            report["schemaVersion"],
            "venviewer.reception-room-fixed-view-cv-triage.v2",
        )
        self.assertEqual(len(report["evidenceBinding"]["inputImages"]), 12)
        self.assertEqual(
            report["evidenceBinding"]["toolSource"]["name"],
            "triage_fixed_views.py",
        )
        self.assertEqual(
            len(report["evidenceBinding"]["toolSource"]["sha256"]), 64
        )
        self.assertIn("version", report["evidenceBinding"]["runtime"]["python"])
        self.assertTrue(verify_report_receipt(report))

    def test_one_byte_input_change_changes_report_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            write_pair_images(root, structured_image())
            before = build_report(root, (("baseline", "candidate"),))
            changed_path = root / "matrix-overview-candidate.png"
            changed_path.write_bytes(changed_path.read_bytes() + b"\x00")
            after = build_report(root, (("baseline", "candidate"),))

        self.assertTrue(verify_report_receipt(before))
        self.assertTrue(verify_report_receipt(after))
        self.assertNotEqual(
            before["evidenceBinding"]["reportReceipt"]["sha256"],
            after["evidenceBinding"]["reportReceipt"]["sha256"],
        )
        before_image = next(
            image
            for image in before["evidenceBinding"]["inputImages"]
            if image["name"] == "matrix-overview-candidate.png"
        )
        after_image = next(
            image
            for image in after["evidenceBinding"]["inputImages"]
            if image["name"] == "matrix-overview-candidate.png"
        )
        self.assertNotEqual(before_image["sha256"], after_image["sha256"])
        self.assertEqual(before_image["sizeBytes"] + 1, after_image["sizeBytes"])

    def test_supplied_capture_manifest_is_hashed_and_verified(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            write_pair_images(root, structured_image())
            integrity = []
            for path in sorted(root.glob("*.png")):
                integrity.append(
                    {
                        "name": path.name,
                        "bytes": path.stat().st_size,
                        "sha256": hashlib.sha256(path.read_bytes())
                        .hexdigest()
                        .upper(),
                    }
                )
            manifest_path = root / "capture-manifest.json"
            manifest_payload = {
                "schemaVersion": "test.fixed-view.v1",
                "screenshotIntegrity": integrity,
            }
            manifest_path.write_text(
                json.dumps(manifest_payload, sort_keys=True),
                encoding="utf-8",
            )

            report = build_report(
                root,
                (("baseline", "candidate"),),
                capture_manifest=manifest_path,
            )
            manifest_payload["note"] = "one bound manifest byte sequence changed"
            manifest_path.write_text(
                json.dumps(manifest_payload, sort_keys=True),
                encoding="utf-8",
            )
            changed_manifest_report = build_report(
                root,
                (("baseline", "candidate"),),
                capture_manifest=manifest_path,
            )

        binding = report["evidenceBinding"]["captureManifest"]
        self.assertTrue(binding["supplied"])
        self.assertEqual(
            binding["inputIntegrityStatus"], "verified_for_all_used_inputs"
        )
        self.assertEqual(binding["declaredSchemaVersion"], "test.fixed-view.v1")
        self.assertEqual(len(binding["sha256"]), 64)
        self.assertTrue(verify_report_receipt(report))
        self.assertTrue(verify_report_receipt(changed_manifest_report))
        self.assertNotEqual(
            report["evidenceBinding"]["reportReceipt"]["sha256"],
            changed_manifest_report["evidenceBinding"]["reportReceipt"]["sha256"],
        )

    def test_capture_manifest_image_mismatch_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            write_pair_images(root, structured_image())
            integrity = []
            for path in sorted(root.glob("*.png")):
                integrity.append(
                    {
                        "name": path.name,
                        "bytes": path.stat().st_size,
                        "sha256": hashlib.sha256(path.read_bytes())
                        .hexdigest()
                        .upper(),
                    }
                )
            integrity[0]["sha256"] = "0" * 64
            manifest_path = root / "capture-manifest.json"
            manifest_path.write_text(
                json.dumps({"screenshotIntegrity": integrity}, sort_keys=True),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "does not match used input images"):
                build_report(
                    root,
                    (("baseline", "candidate"),),
                    capture_manifest=manifest_path,
                )


if __name__ == "__main__":
    unittest.main()
