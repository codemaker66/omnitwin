from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "compare_fixed_views.py"
SPEC = importlib.util.spec_from_file_location("compare_fixed_views", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CompareFixedViewsTests(unittest.TestCase):
    def test_accepts_one_explicit_variant_pair(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            baseline = np.full((24, 32, 3), 64, dtype=np.uint8)
            candidate = np.full((24, 32, 3), 72, dtype=np.uint8)
            for view in MODULE.VIEWS:
                Image.fromarray(baseline).save(root / f"matrix-{view}-baseline.png")
                Image.fromarray(candidate).save(root / f"matrix-{view}-candidate.png")

            report = MODULE.build_report(root, (("baseline", "candidate"),))

            self.assertEqual(
                list(report["comparisons"]),
                ["baseline__candidate"],
            )
            self.assertEqual(
                len(report["comparisons"]["baseline__candidate"]["perView"]),
                len(MODULE.VIEWS),
            )

    def test_pair_parser_rejects_incomplete_input(self) -> None:
        with self.assertRaises(Exception):
            MODULE._parse_pair("baseline-only")


if __name__ == "__main__":
    unittest.main()
