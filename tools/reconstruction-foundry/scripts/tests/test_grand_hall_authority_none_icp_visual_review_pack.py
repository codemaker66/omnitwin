from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np


SCRIPT_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

import grand_hall_authority_none_icp_visual_review_pack as review  # noqa: E402


def _synthetic_seed() -> dict[str, object]:
    return {
        "artifactId": "synthetic-authority-none-registration-seed",
        "finalResult": {
            "candidateArfToCvfRowMajorMatrixFloat64Hex": [
                "3ff0000000000000",
                "0000000000000000",
                "0000000000000000",
                "0000000000000000",
                "0000000000000000",
                "3ff0000000000000",
                "0000000000000000",
                "0000000000000000",
                "0000000000000000",
                "0000000000000000",
                "3ff0000000000000",
                "0000000000000000",
                "0000000000000000",
                "0000000000000000",
                "0000000000000000",
                "3ff0000000000000",
            ],
            "postfitAudit": {
                "metrics": {
                    "meanDistanceMetresFloat64Hex": review._float64_bits(0.04),
                    "p95DistanceMetresFloat64Hex": review._float64_bits(0.09),
                    "rootMeanSquareDistanceMetresFloat64Hex": review._float64_bits(0.05),
                }
            },
        },
    }


def _synthetic_evidence() -> review.ReviewEvidence:
    source = np.asarray(
        [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 1.0, 1.0],
            [2.0, 1.0, 0.5],
        ],
        dtype=np.float64,
    )
    target = source + np.asarray([0.01, 0.02, 0.03], dtype=np.float64)
    source_indices = np.asarray([0, 1, 2, 3], dtype=np.int64)
    target_indices = np.asarray([0, 1, 2, 3], dtype=np.int64)
    distances = np.asarray([0.01, 0.03, 0.06, 0.10], dtype=np.float64)
    all_distances = np.asarray([0.01, 0.03, 0.06, 0.10, 0.2, 1.2], dtype=np.float64)
    return review.ReviewEvidence(
        seed=_synthetic_seed(),
        seed_byte_length=123,
        seed_file_sha256="f" * 64,
        source_inventory={},
        target_inventory={},
        selected_source_indices=np.arange(6, dtype=np.int64),
        transformed_source=source,
        target=target,
        mutual_source_indices=source_indices,
        mutual_target_indices=target_indices,
        mutual_distances=distances,
        all_source_distances=all_distances,
        candidate_matrix=np.eye(4, dtype=np.float64),
    )


class GrandHallAuthorityNoneIcpVisualReviewPackTests(unittest.TestCase):
    def test_replay_implementation_is_the_exact_seed_bound_method(self) -> None:
        actual = hashlib.sha256(Path(review.replay.__file__).read_bytes()).hexdigest()
        self.assertEqual(actual, review.REPLAY_IMPLEMENTATION_SHA256)

    def test_persisted_seed_is_the_exact_file_and_canonical_binding(self) -> None:
        seed_path = (
            SCRIPT_ROOT.parents[2]
            / "docs"
            / "operations"
            / "grand-hall-authority-none-registration-seed-v1.json"
        )
        payload = seed_path.read_bytes()
        self.assertEqual(len(payload), review.SEED_BYTE_LENGTH)
        self.assertEqual(hashlib.sha256(payload).hexdigest(), review.SEED_FILE_SHA256)
        parsed = json.loads(payload)
        self.assertEqual(
            hashlib.sha256(review._canonical_json_bytes(parsed)).hexdigest(),
            review.SEED_CANONICAL_JSON_SHA256,
        )

    def test_builds_deterministic_path_free_fixed_view_payloads(self) -> None:
        evidence = _synthetic_evidence()
        first = review.build_payloads(evidence)
        second = review.build_payloads(evidence)
        self.assertEqual(first, second)
        self.assertEqual(
            set(first),
            {
                "01-top-xy-overlay-residuals.svg",
                "02-front-xz-overlay-residuals.svg",
                "03-side-yz-overlay-residuals.svg",
                "04-residual-inventory.svg",
                "README.md",
                "index.html",
            },
        )
        joined = b"".join(first.values())
        self.assertIn(b"CANDIDATE ONLY", joined)
        self.assertIn(b"NOT AN ACCEPTED TRANSFORM", joined)
        self.assertIn(b"true geometric length", joined)
        self.assertNotIn(b"C:\\", joined)
        self.assertNotIn(b"F:\\", joined)
        for view in review.VIEWS:
            rendered = first[view.file_name]
            self.assertEqual(rendered.count(b"data-pair-ordinal="), 4)

    def test_receipt_is_self_digesting_and_denies_every_authority(self) -> None:
        evidence = _synthetic_evidence()
        payloads = review.build_payloads(evidence)
        receipt = review.build_receipt(
            evidence,
            payloads,
            generator_implementation_sha256="1" * 64,
            replay_implementation_sha256="2" * 64,
        )
        review._verify_receipt_self_digest(receipt)
        self.assertEqual(receipt["authority"]["classification"], "none")
        self.assertIsNone(receipt["authority"]["acceptedTransform"])
        guardrails = receipt["guardrails"]
        self.assertFalse(guardrails["permitsTransformAcceptance"])
        self.assertFalse(guardrails["permitsRuntimeUse"])
        self.assertFalse(guardrails["permitsOutputMasking"])
        self.assertFalse(guardrails["generatedArchitecture"])
        self.assertFalse(
            receipt["candidate"]["matrixReSolvedByThisPack"]
        )
        self.assertEqual(
            sum(
                band["count"]
                for band in receipt["derivedEvidence"][
                    "postfitMutualUnderStrict120Millimetres"
                ]["residualBands"]
            ),
            4,
        )

    def test_create_only_writer_refuses_replacement_and_check_detects_drift(self) -> None:
        evidence = _synthetic_evidence()
        payloads = review.build_payloads(evidence)
        receipt = review.build_receipt(
            evidence,
            payloads,
            generator_implementation_sha256="1" * 64,
            replay_implementation_sha256="2" * 64,
        )
        receipt_bytes = review._canonical_json_bytes(receipt) + b"\n"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "pack"
            copy = root / "receipt-copy.json"
            review.write_pack(output, payloads, receipt_bytes, copy)
            review.check_pack(output, payloads, receipt_bytes, copy)
            with self.assertRaisesRegex(review.ReviewPackError, "already exists"):
                review.write_pack(output, payloads, receipt_bytes, None)
            (output / "README.md").write_bytes(b"drift")
            with self.assertRaisesRegex(review.ReviewPackError, "payload differs"):
                review.check_pack(output, payloads, receipt_bytes, copy)

    def test_strict_json_rejects_duplicate_keys_and_seed_authority_drift(self) -> None:
        with self.assertRaisesRegex(review.ReviewPackError, "duplicate JSON key"):
            review._strict_json_object(b'{"a":1,"a":1}', "fixture")
        guardrails = {
            "acceptedTransform": None,
            "architecturalEvidence": False,
            "authority": "none",
            "coordinatePairs": None,
            "outputMask": None,
            "permitsCoordinateAcceptance": False,
            "permitsOutputMasking": False,
            "permitsPublication": False,
            "permitsRuntimeUse": False,
            "permitsTransformAcceptance": False,
            "productionTrust": None,
            "roomMembershipAuthority": "none",
            "sourceSelectionIsGrandHallMask": False,
        }
        review._require_seed_guardrails({"guardrails": guardrails})
        guardrails["acceptedTransform"] = True
        with self.assertRaisesRegex(review.ReviewPackError, "acceptedTransform"):
            review._require_seed_guardrails({"guardrails": guardrails})

    def test_histograms_fail_closed_on_uncovered_values(self) -> None:
        values = np.asarray([0.01, 0.2], dtype=np.float64)
        with self.assertRaisesRegex(review.ReviewPackError, "do not cover"):
            review._histogram_counts(values, [0.0, 0.1])
        with self.assertRaisesRegex(review.ReviewPackError, "strictly increasing"):
            review._histogram_counts(values, [0.0, 0.1, 0.1])

    def test_canonical_receipt_bytes_have_stable_sha256(self) -> None:
        receipt = {
            "authority": "none",
            "schemaVersion": review.SCHEMA_VERSION,
        }
        payload = review._canonical_json_bytes(receipt)
        self.assertEqual(
            hashlib.sha256(payload).hexdigest(),
            hashlib.sha256(
                json.dumps(
                    receipt,
                    ensure_ascii=False,
                    allow_nan=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode("utf-8")
            ).hexdigest(),
        )


if __name__ == "__main__":
    unittest.main()
