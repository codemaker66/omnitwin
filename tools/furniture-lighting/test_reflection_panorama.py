"""CPU source/orientation checks. No renderer or master-file writes."""
import hashlib
import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image
from prepare_reflection_panorama import source_uv, prepare


ROOT = Path(__file__).resolve().parents[2]


def read_record(path):
    text = path.read_text(encoding="utf-8")
    return json.loads(text[text.index("{"):text.rindex("}") + 1])


class ReflectionPanoramaTest(unittest.TestCase):
    def test_derivative_bytes_dimensions_and_hash_match_receipt(self):
        record = read_record(ROOT / "packages/web/src/data/grand-hall-furniture-reflection-source.ts")
        asset = ROOT / "packages/web/src/assets/experiments" / record["derivative"]
        self.assertEqual(asset.stat().st_size, record["derivative_bytes"])
        self.assertEqual(hashlib.sha256(asset.read_bytes()).hexdigest(), record["derivative_sha256"])
        with Image.open(asset) as image:
            self.assertEqual(list(image.size), record["derivative_size"])
            self.assertEqual(image.mode, "RGB")
        self.assertFalse(record["accepted_registration"])
        self.assertFalse(record["radiometrically_calibrated"])

    def test_candidate_projection_round_trips_real_window_and_chandelier_bearings(self):
        probe = read_record(ROOT / "packages/web/src/data/grand-hall-furniture-lighting-probe.ts")
        record = read_record(ROOT / "packages/web/src/data/grand-hall-furniture-reflection-source.ts")
        self.assertEqual(record["source_sha256"], probe["source_sha256"])
        rotation = np.array(record["candidate_served_from_panorama_rotation"])
        np.testing.assert_allclose(rotation, probe["candidate_served_from_panorama_rotation"], atol=1e-12)
        for region in probe["regions"].values():
            left, top, right, bottom = region["uv_rectangle"]
            u, v = (left + right) / 2, (top + bottom) / 2
            lon, lat = 2 * np.pi * u, (.5 - v) * np.pi
            cv = np.array([np.cos(lat) * np.sin(lon), -np.sin(lat), np.cos(lat) * np.cos(lon)])
            served = rotation @ cv
            # Three r180 equirectUv plus HTML-image vertical convention.
            output_u = np.arctan2(served[2], served[0]) / (2 * np.pi) + .5
            output_v = .5 - np.arcsin(served[1]) / np.pi
            lon_out, lat_out = (output_u - .5) * 2 * np.pi, (.5 - output_v) * np.pi
            reconstructed = np.array([np.cos(lat_out) * np.cos(lon_out), np.sin(lat_out), np.cos(lat_out) * np.sin(lon_out)])
            actual_u, actual_v = source_uv(reconstructed, rotation)
            self.assertAlmostEqual(float(actual_u), u, places=6)
            self.assertAlmostEqual(float(actual_v), v, places=6)

    def test_native_cv_zenith_becomes_served_up(self):
        record = read_record(ROOT / "packages/web/src/data/grand-hall-furniture-reflection-source.ts")
        rotation = np.array(record["candidate_served_from_panorama_rotation"])
        zenith = rotation @ np.array([0, -1, 0])
        self.assertGreater(zenith[1], .999)
        u, v = source_uv(np.array([0, 1, 0]), rotation)
        self.assertTrue(0 <= u < 1)
        self.assertLess(v, .005)

    def test_master_output_collision_rejected_before_reading(self):
        path = Path("must-not-be-written.jpg")
        with self.assertRaisesRegex(ValueError, "overwrite"):
            prepare(path, Path("unused.ts"), path, Path("unused-receipt.ts"))


if __name__ == "__main__":
    unittest.main()
