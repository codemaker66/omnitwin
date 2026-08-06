from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))

from render_triage_report import (  # noqa: E402
    CLEAR_LABEL,
    EvidenceError,
    NOT_ASSESSABLE_LABEL,
    WARNING_LABEL,
    render_triage_report,
)
from triage_fixed_views import VIEWS, build_report  # noqa: E402


BAD_PAIR = ("mobile-sh0-spz-leaf", "mobile-sh0-spz-all-invalid")
VALID_PAIR = ("quality-sh3-ply", "quality-sh3-sog-leaf")


def structured_image(size: int = 96) -> np.ndarray:
    image = np.full((size, size, 3), 0.08, dtype=np.float64)
    image[16:80, 20:26, :] = 0.9
    image[16:22, 20:78, :] = 0.9
    image[74:80, 20:78, :] = 0.9
    image[34:66, 46:72, 0] = 0.68
    image[34:66, 46:72, 1] = 0.35
    image[34:66, 46:72, 2] = 0.18
    return image


def write_variant(root: Path, variant: str, value: np.ndarray) -> None:
    pixels = np.clip(value * 255.0, 0, 255).astype(np.uint8)
    for view in VIEWS:
        Image.fromarray(pixels, mode="RGB").save(
            root / f"matrix-{view}-{variant}.png",
            format="PNG",
            compress_level=9,
        )


def make_inputs(root: Path, pairs: tuple[tuple[str, str], ...]) -> None:
    baseline = structured_image()
    doubled = 0.5 * baseline + 0.5 * np.roll(baseline, 6, axis=1)
    values = {
        BAD_PAIR[0]: baseline,
        BAD_PAIR[1]: doubled,
        VALID_PAIR[0]: baseline,
        VALID_PAIR[1]: baseline.copy(),
        "baseline": baseline,
        "candidate": doubled,
    }
    for pair in pairs:
        for variant in pair:
            write_variant(root, variant, values[variant])


def write_report(
    root: Path,
    pairs: tuple[tuple[str, str], ...] = (("baseline", "candidate"),),
) -> tuple[Path, dict]:
    make_inputs(root, pairs)
    report = build_report(root, pairs)
    path = root / "triage.json"
    path.write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return path, report


def canonical_sha256(value: object) -> str:
    data = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(data).hexdigest().upper()


def resign(report: dict) -> None:
    payload = copy.deepcopy(report)
    payload["evidenceBinding"].pop("reportReceipt", None)
    report["evidenceBinding"]["reportReceipt"] = {
        "algorithm": "SHA-256",
        "sha256": canonical_sha256(payload),
    }


def rewrite_report(path: Path, report: dict) -> None:
    path.write_text(
        json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def tree_bytes(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


class RenderTriageReportTests(unittest.TestCase):
    def test_deterministic_lossless_boards_and_plain_language_indexes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            report_path, _report = write_report(root, (BAD_PAIR, VALID_PAIR))
            source_paths = sorted(root.glob("matrix-*.png"))
            before = {
                path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                for path in source_paths
            }

            first = render_triage_report(report_path, root, root / "first")
            second = render_triage_report(report_path, root, root / "second")

            self.assertEqual(tree_bytes(root / "first"), tree_bytes(root / "second"))
            self.assertEqual(len(first["boards"]), 12)
            self.assertEqual(first, second)
            self.assertEqual(first["reviewWarningLabel"], WARNING_LABEL)
            self.assertEqual(first["triageClearLabel"], CLEAR_LABEL)
            self.assertEqual(first["notAssessableLabel"], NOT_ASSESSABLE_LABEL)
            self.assertEqual(
                first["sourceReport"]["sha256"],
                hashlib.sha256(report_path.read_bytes()).hexdigest().upper(),
            )

            expected_overviews = {
                f"{BAD_PAIR[0]}__{BAD_PAIR[1]}--overview.png",
                f"{VALID_PAIR[0]}__{VALID_PAIR[1]}--overview.png",
            }
            board_names = {
                Path(board["file"]).name for board in first["boards"]
            }
            self.assertTrue(expected_overviews.issubset(board_names))
            bad_overview = next(
                board
                for board in first["boards"]
                if board["pairId"] == f"{BAD_PAIR[0]}__{BAD_PAIR[1]}"
                and board["view"] == "overview"
            )
            valid_overview = next(
                board
                for board in first["boards"]
                if board["pairId"] == f"{VALID_PAIR[0]}__{VALID_PAIR[1]}"
                and board["view"] == "overview"
            )
            self.assertTrue(
                any(bad_overview["concentrationRegions"].values())
            )
            self.assertFalse(
                any(valid_overview["concentrationRegions"].values())
            )
            self.assertEqual(bad_overview["statusLabel"], WARNING_LABEL)
            self.assertEqual(valid_overview["statusLabel"], CLEAR_LABEL)

            markdown = (root / "first" / "README.md").read_text(encoding="utf-8")
            self.assertIn(WARNING_LABEL, markdown)
            self.assertIn("does **not** prove what is physically in the room", markdown)
            self.assertIn("not approval", markdown)
            serialized_index = (root / "first" / "index.json").read_text(
                encoding="utf-8"
            )
            self.assertIn(WARNING_LABEL, serialized_index)
            self.assertNotIn(temporary_root, serialized_index)
            self.assertNotIn(temporary_root, markdown)

            bad_board_path = (
                root
                / "first"
                / "boards"
                / f"{BAD_PAIR[0]}__{BAD_PAIR[1]}--overview.png"
            )
            with Image.open(bad_board_path) as board:
                self.assertEqual(board.info["warningLabel"], WARNING_LABEL)
                self.assertEqual(board.info["statusLabel"], WARNING_LABEL)
                width = int(board.info["inputPixelWidth"])
                height = int(board.info["inputPixelHeight"])
                y = int(board.info["imagePanelY"])
                baseline_x = int(board.info["baselinePanelX"])
                candidate_x = int(board.info["candidatePanelX"])
                baseline_name = board.info["baselineFile"]
                candidate_name = board.info["candidateFile"]
                baseline_panel = np.asarray(
                    board.crop((baseline_x, y, baseline_x + width, y + height))
                )
                candidate_panel = np.asarray(
                    board.crop((candidate_x, y, candidate_x + width, y + height))
                )
            valid_board_path = (
                root
                / "first"
                / "boards"
                / f"{VALID_PAIR[0]}__{VALID_PAIR[1]}--overview.png"
            )
            with Image.open(valid_board_path) as valid_board:
                self.assertEqual(valid_board.info["statusLabel"], CLEAR_LABEL)
                self.assertNotIn("warningLabel", valid_board.info)
            with Image.open(root / baseline_name) as baseline_source:
                np.testing.assert_array_equal(
                    baseline_panel, np.asarray(baseline_source.convert("RGB"))
                )
            with Image.open(root / candidate_name) as candidate_source:
                np.testing.assert_array_equal(
                    candidate_panel, np.asarray(candidate_source.convert("RGB"))
                )

            after = {
                path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                for path in source_paths
            }
            self.assertEqual(before, after)
            for path in (root / "first").rglob("*"):
                if path.is_file():
                    self.assertNotIn(temporary_root.encode("utf-8"), path.read_bytes())

    def test_not_assessable_board_uses_its_own_human_review_label(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            pair = ("flat-baseline", "flat-candidate")
            flat = np.full((96, 96, 3), 0.5, dtype=np.float64)
            write_variant(root, pair[0], flat)
            write_variant(root, pair[1], flat.copy())
            report = build_report(root, (pair,))
            report_path = root / "triage.json"
            rewrite_report(report_path, report)

            result = render_triage_report(report_path, root, root / "output")

            self.assertTrue(
                all(board["verdict"] == "not_assessable" for board in result["boards"])
            )
            self.assertTrue(
                all(
                    board["statusLabel"] == NOT_ASSESSABLE_LABEL
                    for board in result["boards"]
                )
            )
            overview = (
                root
                / "output"
                / "boards"
                / "flat-baseline__flat-candidate--overview.png"
            )
            with Image.open(overview) as board:
                self.assertEqual(board.info["statusLabel"], NOT_ASSESSABLE_LABEL)
                self.assertNotIn("warningLabel", board.info)

    def test_path_traversal_in_report_is_rejected_even_if_resigned(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            report_path, report = write_report(root)
            report["comparisons"][0]["perView"][0]["baselineFile"] = "../secret.png"
            resign(report)
            rewrite_report(report_path, report)

            with self.assertRaisesRegex(EvidenceError, "basename|path"):
                render_triage_report(report_path, root, root / "output")
            self.assertFalse((root / "output").exists())

    def test_report_and_input_tampering_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            report_path, report = write_report(root)
            report["comparisons"][0]["perView"][0]["verdict"] = "triage_clear"
            rewrite_report(report_path, report)
            with self.assertRaisesRegex(EvidenceError, "receipt mismatch"):
                render_triage_report(report_path, root, root / "report-output")

        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            report_path, report = write_report(root)
            name = report["comparisons"][0]["perView"][0]["candidateFile"]
            image_path = root / name
            image_path.write_bytes(image_path.read_bytes() + b"\x00")
            with self.assertRaisesRegex(EvidenceError, "hash or size mismatch"):
                render_triage_report(report_path, root, root / "image-output")

    def test_resigned_but_stale_measurements_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            report_path, report = write_report(root)
            report["comparisons"][0]["perView"][0]["metrics"][
                "changedPixelFraction"
            ] = 0.0
            resign(report)
            rewrite_report(report_path, report)

            with self.assertRaisesRegex(EvidenceError, "stale report measurements"):
                render_triage_report(report_path, root, root / "output")

    def test_unsupported_schema_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            report_path, report = write_report(root)
            report["schemaVersion"] = "venviewer.reception-room-fixed-view-cv-triage.v3"
            resign(report)
            rewrite_report(report_path, report)

            with self.assertRaisesRegex(EvidenceError, "unsupported or stale report schema"):
                render_triage_report(report_path, root, root / "output")

    def test_different_dimensions_are_rejected_even_if_binding_is_updated(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_root:
            root = Path(temporary_root)
            report_path, report = write_report(root)
            row = report["comparisons"][0]["perView"][0]
            candidate_name = row["candidateFile"]
            changed = np.zeros((95, 96, 3), dtype=np.uint8)
            Image.fromarray(changed, mode="RGB").save(root / candidate_name, format="PNG")
            data = (root / candidate_name).read_bytes()
            binding = next(
                item
                for item in report["evidenceBinding"]["inputImages"]
                if item["name"] == candidate_name
            )
            binding["sizeBytes"] = len(data)
            binding["sha256"] = hashlib.sha256(data).hexdigest().upper()
            binding["pixelDimensions"] = [96, 95]
            resign(report)
            rewrite_report(report_path, report)

            with self.assertRaisesRegex(EvidenceError, "different screenshot dimensions"):
                render_triage_report(report_path, root, root / "output")


if __name__ == "__main__":
    unittest.main()
