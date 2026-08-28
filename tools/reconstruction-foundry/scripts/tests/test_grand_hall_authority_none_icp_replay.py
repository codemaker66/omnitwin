from __future__ import annotations

import json
import hashlib
from pathlib import Path
import struct
import sys
import tempfile
import unittest

import numpy as np


SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

import grand_hall_authority_none_icp_replay as replay  # noqa: E402


def _obj_vertices(points: np.ndarray) -> list[str]:
    return ["v " + " ".join(format(float(value), ".17g") for value in point) for point in points]


def _float64_from_bits(value: str) -> float:
    return struct.unpack(">d", bytes.fromhex(value))[0]


class GrandHallAuthorityNoneIcpReplayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write_exact_initial_alignment_fixtures(self) -> tuple[Path, Path]:
        main = np.asarray(
            [
                [0.0, 0.0, 0.0],
                [2.0, 0.0, 0.0],
                [0.0, 3.0, 0.0],
                [0.0, 0.0, 4.0],
                [1.2, 0.7, 1.6],
            ],
            dtype=np.float64,
        )
        outside = np.asarray(
            [[20.0, 20.0, 20.0], [21.0, 20.0, 20.0], [20.0, 21.0, 20.0]],
            dtype=np.float64,
        )
        source_points = np.vstack((main, outside))
        source_lines = _obj_vertices(source_points)
        source_lines.extend(
            [
                "f 1 2 3",
                "f 1 2 4",
                "f 1 3 4",
                "f 2 3 4",
                "f 2 4 5",
                "f 6 7 8",
            ]
        )
        source = self.root / "source-secret-location.obj"
        source.write_text("\n".join(source_lines) + "\n", encoding="utf-8")

        target_main = main @ replay.INITIAL_ROTATION.T + replay.INITIAL_TRANSLATION
        unrelated = np.asarray(
            [[100.0, 100.0, 100.0], [101.0, 100.0, 100.0], [100.0, 101.0, 100.0]],
            dtype=np.float64,
        )
        target_lines = _obj_vertices(np.vstack((target_main, unrelated)))
        target_lines.extend(
            [
                "g ignored_group001_sub008",
                "f 6 7 8",
                "g fixture_group001_sub009",
                "f 1 2 3",
                "f 1 2 4",
                "f 1 3 4",
                "f 2 3 4",
                "f 2 4 5",
            ]
        )
        target = self.root / "target-secret-location.obj"
        target.write_text("\n".join(target_lines) + "\n", encoding="utf-8")
        return source, target

    def test_recovered_threshold_schedule_is_exactly_8_12_12_8(self) -> None:
        schedule = [replay._threshold_for_iteration(index) for index in range(40)]
        self.assertEqual(schedule, [0.6] * 8 + [0.35] * 12 + [0.2] * 12 + [0.12] * 8)
        with self.assertRaises(replay.ReplayGuardError):
            replay._threshold_for_iteration(40)

    def test_replays_fixed_40_steps_and_emits_a_path_redacted_receipt(self) -> None:
        source, target = self._write_exact_initial_alignment_fixtures()
        receipt = replay.replay_grand_hall_authority_none_icp(source, target)

        self.assertEqual(receipt["authority"]["classification"], "none")
        self.assertFalse(receipt["authority"]["acceptedTransform"])
        self.assertEqual(receipt["algorithm"]["iterationCount"], 40)
        self.assertFalse(receipt["algorithm"]["convergenceClaim"])
        self.assertEqual(len(receipt["iterations"]), 40)
        self.assertEqual(
            receipt["sourceSelection"]["selectedOrderedSourceIndexCount"], 5
        )
        self.assertEqual(
            receipt["inputs"]["fixed"]["selectedOrderedGlobalVertexIndexCount"], 5
        )
        self.assertTrue(
            all(
                item["correspondences"]["correspondenceCount"] == 5
                for item in receipt["iterations"]
            )
        )
        final = receipt["result"]["finalTransform"]
        rotation = np.asarray(
            [[_float64_from_bits(value) for value in row] for row in final["rotationFloat64HexRowMajor"]]
        )
        translation = np.asarray(
            [_float64_from_bits(value) for value in final["translationFloat64Hex"]]
        )
        np.testing.assert_allclose(rotation, replay.INITIAL_ROTATION, atol=1e-14, rtol=0.0)
        np.testing.assert_allclose(translation, replay.INITIAL_TRANSLATION, atol=1e-14, rtol=0.0)

        canonical = replay.canonical_json_bytes(receipt)
        parsed = json.loads(canonical)
        self.assertEqual(parsed, receipt)
        rendered = canonical.decode("utf-8")
        self.assertNotIn(str(self.root), rendered)
        self.assertNotIn(source.name, rendered)
        self.assertNotIn(target.name, rendered)

    def test_receipt_floats_are_exact_binary64_bit_patterns(self) -> None:
        source, target = self._write_exact_initial_alignment_fixtures()
        receipt = replay.replay_grand_hall_authority_none_icp(source, target)
        initial = receipt["algorithm"]["initialTransform"]
        self.assertEqual(initial["rotationFloat64HexRowMajor"][0][1], "bff0000000000000")
        self.assertEqual(initial["translationFloat64Hex"][2], "4002666666666666")
        self.assertEqual(receipt["sourceSelection"]["paddingMetresFloat64Hex"], "3fe8000000000000")

    def test_seed_adapter_is_derived_from_the_same_receipt_fields(self) -> None:
        source, target = self._write_exact_initial_alignment_fixtures()
        receipt = replay.replay_grand_hall_authority_none_icp(source, target)
        adapter = receipt["seedAdapterV1"]
        self.assertEqual(adapter["schemaVersion"], replay.SEED_ADAPTER_SCHEMA_VERSION)
        self.assertEqual(adapter["authority"], "none")
        self.assertEqual(
            receipt["algorithmCanonicalJsonSha256"],
            replay.canonical_json_sha256(receipt["algorithm"]),
        )
        self.assertEqual(
            adapter["algorithmCanonicalJsonSha256"],
            receipt["algorithmCanonicalJsonSha256"],
        )
        self.assertEqual(len(adapter["iterations"]), 40)
        self.assertEqual(
            adapter["iterations"][-1]["correspondencePairInventoryRawSha256"],
            receipt["iterations"][-1]["correspondences"][
                "orderedSourceTargetPairsPackedLittleEndianInt64RawSha256"
            ],
        )
        self.assertEqual(
            adapter["postfitMutualAudit"]["correspondenceCount"],
            receipt["result"]["finalMutualUnderLastThresholdCount"],
        )
        self.assertEqual(len(adapter["candidateArfToCvfRowMajorMatrixFloat64Hex"]), 16)

    def test_raw_and_domain_separated_array_digests_cannot_be_conflated(self) -> None:
        values = np.asarray([1.0, 2.0], dtype=np.float64)
        expected_raw = hashlib.sha256(struct.pack("<dd", 1.0, 2.0)).hexdigest()
        self.assertEqual(
            replay._raw_array_sha256(values, "<f8", name="fixture"),
            expected_raw,
        )
        self.assertNotEqual(
            replay._ordered_array_sha256(values, "<f8", name="fixture"),
            expected_raw,
        )

    def test_stable_snapshot_rejects_a_path_replaced_after_read(self) -> None:
        source = self.root / "source.obj"
        replacement = self.root / "replacement.obj"
        source.write_bytes(b"first-source-bytes")
        replacement.write_bytes(b"other-source-bytes")

        def replace_after_read() -> None:
            replacement.replace(source)

        with self.assertRaisesRegex(replay.ReplayGuardError, "changed while it was being read"):
            replay._stable_regular_file_snapshot(
                source,
                label="fixture",
                after_read_before_final_stat=replace_after_read,
            )

    def test_identical_file_bytes_in_different_paths_produce_identical_receipts(self) -> None:
        source, target = self._write_exact_initial_alignment_fixtures()
        first = replay.replay_grand_hall_authority_none_icp(source, target)
        alternate = self.root / "alternate"
        alternate.mkdir()
        source_copy = alternate / "a.obj"
        target_copy = alternate / "b.obj"
        source_copy.write_bytes(source.read_bytes())
        target_copy.write_bytes(target.read_bytes())
        second = replay.replay_grand_hall_authority_none_icp(source_copy, target_copy)
        self.assertEqual(replay.canonical_json_sha256(first), replay.canonical_json_sha256(second))
        self.assertEqual(first, second)

    def test_nearest_neighbour_exact_ties_are_inventoried_without_changing_rank1(self) -> None:
        candidates = np.asarray(
            [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [2.0, 2.0, 2.0]],
            dtype=np.float64,
        )
        query = np.asarray([[0.0, 0.0, 0.0]], dtype=np.float64)
        distances, indices, audit = replay._query_with_tie_audit(
            replay.cKDTree(candidates),
            query,
            candidate_count=len(candidates),
            context="synthetic-tie",
        )
        self.assertEqual(distances.tolist(), [0.0])
        self.assertIn(int(indices[0]), (0, 1))
        self.assertEqual(audit["exactTieCount"], 1)
        self.assertEqual(audit["exactTieQueryOrdinals"], [0])
        self.assertEqual(audit["guardedNearTieQueryOrdinalsIncludingExact"], [0])

    def test_two_run_gate_requires_an_exact_canonical_repeat(self) -> None:
        source, target = self._write_exact_initial_alignment_fixtures()
        receipt = replay.replay_grand_hall_authority_none_icp_twice(source, target)
        validation = receipt["repeatedReplayValidation"]
        self.assertEqual(validation["sameProcessRunCount"], 2)
        self.assertTrue(validation["canonicalReceiptBytesIdentical"])
        unvalidated = dict(receipt)
        del unvalidated["repeatedReplayValidation"]
        self.assertEqual(
            validation["canonicalUnvalidatedReceiptSha256"],
            replay.canonical_json_sha256(unvalidated),
        )
        self.assertEqual(
            validation["scope"],
            "exact-full-receipt-including-correspondence-and-matrix-bytes",
        )

    def test_rank_deficient_kabsch_fit_fails_closed(self) -> None:
        source = np.asarray(
            [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0], [3.0, 0.0, 0.0]],
            dtype=np.float64,
        )
        with self.assertRaisesRegex(replay.ReplayGuardError, "rank-deficient"):
            replay._fit_kabsch(source, source.copy(), context="synthetic-degenerate")

    def test_logical_identifiers_cannot_smuggle_paths_into_the_receipt(self) -> None:
        source, target = self._write_exact_initial_alignment_fixtures()
        with self.assertRaisesRegex(replay.ReplayGuardError, "path-free"):
            replay.replay_grand_hall_authority_none_icp(
                source,
                target,
                source_logical_id="C:/secret/source.obj",
            )


if __name__ == "__main__":
    unittest.main()
