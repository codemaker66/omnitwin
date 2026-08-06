from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_ROOT))
REPO_ROOT = Path(__file__).resolve().parents[3]

import verify_goal_artifacts as verifier  # noqa: E402


class ReceptionGoalArtifactVerifierTests(unittest.TestCase):
    def _fixture(self, temporary: str) -> Path:
        root = Path(temporary)
        for relative in verifier.REQUIRED_ARTIFACTS.values():
            source = REPO_ROOT / relative
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        for relative, _size, _digest in verifier.EXPECTED_REPORT_RECEIPTS.values():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / relative, target)
        for expectation in verifier.EXPECTED_SOURCE_PHOTO_SUPPORT_ARTIFACTS.values():
            relative = expectation["path"]
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / relative, target)
        for expectation in verifier.EXPECTED_RUNTIME_DELIVERY_SUPPORT_ARTIFACTS.values():
            relative = expectation["path"]
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / relative, target)
        renderer_paths = {
            expectation["path"]
            for expectation in verifier.EXPECTED_RENDERER_CAPTURE_SUPPORT_ARTIFACTS.values()
        }
        runtime_paths = {
            Path(value) for value in verifier._reception_capture_runtime_build_inputs(REPO_ROOT)
        }
        for relative in renderer_paths | runtime_paths:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / relative, target)
        fixed_path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
        fixed = json.loads(fixed_path.read_text(encoding="utf-8"))
        triage = next(
            item
            for item in fixed["postCaptureRuns"]
            if item["id"] == "reception-captured-quality-triage-2026-07-18"
        )
        for field in ("evidenceRef", "report"):
            relative = Path(triage[field])
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO_ROOT / relative, target)
        return root

    def _current_evidence(self) -> dict[str, object]:
        path = REPO_ROOT / verifier.REQUIRED_ARTIFACTS["evidence"]
        return json.loads(path.read_text(encoding="utf-8"))

    def _runtime_delivery_receipt_digest(self, payload: dict[str, object]) -> str:
        receipt = payload["runtimeDeliveryHardeningImplementationReceipt"]
        return verifier._canonical_digest(receipt)

    @staticmethod
    def _different_json_value(value: object) -> object:
        if isinstance(value, bool):
            return not value
        if isinstance(value, str):
            return f"changed-{value}"
        if isinstance(value, list):
            return ["unexpected"]
        if value is None:
            return "unexpected"
        if isinstance(value, int):
            return value + 1
        return None

    def _assert_json_mutation_rejected(
        self,
        root: Path,
        artifact: str,
        keys: tuple[str, ...],
        value: object,
        error_code: str,
    ) -> None:
        path = root / verifier.REQUIRED_ARTIFACTS[artifact]
        payload = json.loads(path.read_text(encoding="utf-8"))
        cursor = payload
        for key in keys[:-1]:
            cursor = cursor[key]
        cursor[keys[-1]] = value
        path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaisesRegex(verifier.VerificationError, error_code):
            verifier.verify_goal_artifacts(root)

    def _assert_json_field_removed_rejected(
        self,
        root: Path,
        artifact: str,
        keys: tuple[str, ...],
        error_code: str,
    ) -> None:
        path = root / verifier.REQUIRED_ARTIFACTS[artifact]
        payload = json.loads(path.read_text(encoding="utf-8"))
        cursor = payload
        for key in keys[:-1]:
            cursor = cursor[key]
        del cursor[keys[-1]]
        path.write_text(json.dumps(payload), encoding="utf-8")
        with self.assertRaisesRegex(verifier.VerificationError, error_code):
            verifier.verify_goal_artifacts(root)

    def test_current_artifacts_pass_without_claiming_product_completion(self) -> None:
        result = verifier.verify_goal_artifacts(REPO_ROOT)
        self.assertEqual(result["status"], "PASS_DECISION_READY_PRODUCT_GOAL_OPEN")
        self.assertFalse(result["productGoalComplete"])
        self.assertEqual(result["currentCandidateDecision"], verifier.EXPECTED_CURRENT_DECISION)
        self.assertEqual(result["approachCount"], 12)
        self.assertEqual(result["assetReceiptCount"], 50)
        self.assertEqual(result["sourcePhotoSupportArtifactCount"], 9)
        self.assertEqual(result["runtimeDeliverySupportArtifactCount"], 34)
        self.assertEqual(result["blockingCriteria"], ["A", "E", "F", "G", "H"])

    def test_runtime_profile_security_critical_fields_reject_mutation_and_omission(self) -> None:
        for field, expected in verifier.EXPECTED_RUNTIME_PROFILE_SECURITY_CRITICAL.items():
            for remove in (False, True):
                with self.subTest(field=field, remove=remove):
                    payload = self._current_evidence()
                    block = payload["postCutoffAddenda"]["runtimeProfileSecurityHardening"]
                    if remove:
                        del block[field]
                    else:
                        block[field] = self._different_json_value(expected)
                    digest = self._runtime_delivery_receipt_digest(payload)
                    with self.assertRaisesRegex(
                        verifier.VerificationError,
                        "RUNTIME_PROFILE_SECURITY_FAIL_CLOSED_STATE_CHANGED",
                    ):
                        verifier._verify_runtime_profile_security_block(payload, digest)

    def test_post_capture_delivery_critical_fields_reject_mutation_and_omission(self) -> None:
        expected_fields = verifier.EXPECTED_POST_CAPTURE_RUNTIME_DELIVERY_CRITICAL
        for field, expected in expected_fields.items():
            for remove in (False, True):
                with self.subTest(field=field, remove=remove):
                    payload = self._current_evidence()
                    block = payload["postCaptureRuntimeDeliveryHardening"]
                    if remove:
                        del block[field]
                    else:
                        block[field] = self._different_json_value(expected)
                    digest = self._runtime_delivery_receipt_digest(payload)
                    with self.assertRaisesRegex(
                        verifier.VerificationError,
                        "POST_CAPTURE_RUNTIME_DELIVERY_FAIL_CLOSED_STATE_CHANGED",
                    ):
                        verifier._verify_post_capture_runtime_delivery_block(payload, digest)

    def test_runtime_delivery_common_gate_fields_reject_mutation_and_omission(self) -> None:
        fields = (
            "anonymousPresentationEligibility",
            "presentationContractState",
            "compositionBinding",
            "immutableReviewIds",
            "externalActivationRequirements",
            "implementationReceiptDigest",
        )
        for block_name, field, remove in (
            (name, field, remove)
            for name in ("security", "postCapture")
            for field in fields
            for remove in (False, True)
        ):
            with self.subTest(block=block_name, field=field, remove=remove):
                payload = self._current_evidence()
                block = payload["postCutoffAddenda"]["runtimeProfileSecurityHardening"] \
                    if block_name == "security" else payload["postCaptureRuntimeDeliveryHardening"]
                value = block[field]
                if remove:
                    del block[field]
                else:
                    block[field] = self._different_json_value(value)
                digest = self._runtime_delivery_receipt_digest(payload)
                verify = verifier._verify_runtime_profile_security_block \
                    if block_name == "security" else verifier._verify_post_capture_runtime_delivery_block
                with self.assertRaises(verifier.VerificationError):
                    verify(payload, digest)

    def test_runtime_delivery_nested_gate_fields_reject_mutation_and_omission(self) -> None:
        expected_sections = {
            "anonymousPresentationEligibility": verifier.EXPECTED_RUNTIME_DELIVERY_ELIGIBILITY,
            "presentationContractState": verifier.EXPECTED_RUNTIME_DELIVERY_PRESENTATION_STATE,
            "compositionBinding": verifier.EXPECTED_RUNTIME_DELIVERY_COMPOSITION_BINDING,
        }
        for block_name in ("security", "postCapture"):
            for section, expected in expected_sections.items():
                for field, value in expected.items():
                    for remove in (False, True):
                        with self.subTest(block=block_name, section=section, field=field, remove=remove):
                            payload = self._current_evidence()
                            block = payload["postCutoffAddenda"]["runtimeProfileSecurityHardening"] \
                                if block_name == "security" else payload["postCaptureRuntimeDeliveryHardening"]
                            if remove:
                                del block[section][field]
                            else:
                                block[section][field] = self._different_json_value(value)
                            digest = self._runtime_delivery_receipt_digest(payload)
                            verify = verifier._verify_runtime_profile_security_block \
                                if block_name == "security" else verifier._verify_post_capture_runtime_delivery_block
                            with self.assertRaises(verifier.VerificationError):
                                verify(payload, digest)

    def test_runtime_delivery_metadata_gates_reject_mutation_and_omission(self) -> None:
        for remove in (False, True):
            payload = self._current_evidence()
            security = payload["postCutoffAddenda"]["runtimeProfileSecurityHardening"]
            if remove:
                del security["publicMetadataAndMemberRequestGates"]
            else:
                security["publicMetadataAndMemberRequestGates"] = ["room showcase opt-in"]
            with self.assertRaisesRegex(verifier.VerificationError, "RUNTIME_DELIVERY_METADATA_GATES_CHANGED"):
                verifier._verify_runtime_profile_security_block(
                    payload, self._runtime_delivery_receipt_digest(payload)
                )
        for remove in (False, True):
            payload = self._current_evidence()
            block = payload["postCaptureRuntimeDeliveryHardening"]
            if remove:
                del block["metadataGate"]
            else:
                block["metadataGate"] = "room showcase opt-in"
            with self.assertRaises(verifier.VerificationError):
                verifier._verify_post_capture_runtime_delivery_block(
                    payload, self._runtime_delivery_receipt_digest(payload)
                )

    def test_runtime_delivery_receipt_semantics_reject_mutation_and_omission(self) -> None:
        for field, expected in verifier.EXPECTED_RUNTIME_DELIVERY_RECEIPT_SEMANTICS.items():
            for remove in (False, True):
                with self.subTest(field=field, remove=remove):
                    payload = self._current_evidence()
                    semantics = payload["runtimeDeliveryHardeningImplementationReceipt"]["semanticChecks"]
                    if remove:
                        del semantics[field]
                    else:
                        semantics[field] = self._different_json_value(expected)
                    with self.assertRaisesRegex(
                        verifier.VerificationError,
                        "RUNTIME_DELIVERY_RECEIPT_SEMANTICS_CHANGED",
                    ):
                        verifier._verify_runtime_delivery_receipt(payload)

    def test_runtime_delivery_receipt_boundary_and_artifact_set_reject_changes(self) -> None:
        for field in ("schemaVersion", "authority"):
            for remove in (False, True):
                with self.subTest(field=field, remove=remove):
                    payload = self._current_evidence()
                    receipt = payload["runtimeDeliveryHardeningImplementationReceipt"]
                    if remove:
                        del receipt[field]
                    else:
                        receipt[field] = "changed"
                    with self.assertRaises(verifier.VerificationError):
                        verifier._verify_runtime_delivery_receipt(payload)
        payload = self._current_evidence()
        receipt, _ = verifier._verify_runtime_delivery_receipt(payload)
        del receipt["supportArtifacts"]["apiEnvironment"]
        with self.assertRaisesRegex(
            verifier.VerificationError,
            "RUNTIME_DELIVERY_SUPPORT_ARTIFACT_SET_CHANGED",
        ):
            verifier._verify_runtime_delivery_support_artifacts(REPO_ROOT, receipt)

    def test_runtime_delivery_support_receipt_rejects_each_field_mutation_and_omission(self) -> None:
        for field in verifier.EXPECTED_RUNTIME_DELIVERY_ARTIFACT_KEYS:
            for remove in (False, True):
                with self.subTest(field=field, remove=remove):
                    payload = self._current_evidence()
                    receipt, _ = verifier._verify_runtime_delivery_receipt(payload)
                    record = receipt["supportArtifacts"]["apiEnvironment"]
                    if remove:
                        del record[field]
                    else:
                        record[field] = self._different_json_value(record[field])
                    with self.assertRaises(verifier.VerificationError):
                        verifier._verify_runtime_delivery_support_artifacts(REPO_ROOT, receipt)

    def test_runtime_delivery_source_tokens_and_absent_append_only_triggers_are_checked(self) -> None:
        cases = (
            ("apiReviewedProfileMatcher", "publicPresentationCandidate: false", ""),
            ("apiPublicGateTests", "fails closed when QA package identity, composition, chunk count, or bytes drift", ""),
            ("runtimeTransformMigration", "", 'BEFORE UPDATE ON "runtime_transform_artifacts"'),
            ("runtimeQaMigration", "", 'BEFORE DELETE ON "runtime_qa_records"'),
        )
        for label, removed, added in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temporary:
                source = REPO_ROOT / verifier.EXPECTED_RUNTIME_DELIVERY_SUPPORT_ARTIFACTS[label]["path"]
                target = Path(temporary) / source.name
                text = source.read_text(encoding="utf-8")
                target.write_text(text.replace(removed, "", 1) + added, encoding="utf-8")
                with self.assertRaises(verifier.VerificationError):
                    verifier._verify_runtime_delivery_source_semantics(target, label)

    def test_stale_candidate_decision_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["currentQualityReconciliation"]["currentDecision"] = (
                "quality_is_current_winner"
            )
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "STALE_OR_UNSAFE_CANDIDATE_DECISION"
            ):
                verifier.verify_goal_artifacts(root)

    def test_missing_approach_factor_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["decisionMatrix"]
            text = path.read_text(encoding="utf-8")
            text = text.replace("| Falsifying test |", "| Removed test |", 1)
            path.write_text(text, encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "APPROACH_FACTOR_MISSING"
            ):
                verifier.verify_goal_artifacts(root)

    def test_blank_approach_factor_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["decisionMatrix"]
            text = path.read_text(encoding="utf-8")
            mechanism = next(
                line for line in text.splitlines() if line.startswith("| Mechanism |")
            )
            path.write_text(text.replace(mechanism, "| Mechanism |   |", 1), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "APPROACH_FACTOR_EMPTY"
            ):
                verifier.verify_goal_artifacts(root)

    def test_resume_phrase_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["currentInterpretation"]["requiredExactResumePhrase"] = "resume"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "LCC_PERMISSION_BOUNDARY_MISMATCH"
            ):
                verifier.verify_goal_artifacts(root)

    def test_evidence_action_phrase_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["currentQualityReconciliation"]["currentAction"][
                "requiredExactResumePhrase"
            ] = "resume"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "EVIDENCE_ACTION_PERMISSION_MISMATCH"
            ):
                verifier.verify_goal_artifacts(root)

    def test_missing_captured_quality_run_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["postCaptureRuns"] = [
                run
                for run in payload["postCaptureRuns"]
                if run["id"] != "reception-captured-quality-triage-2026-07-18"
            ]
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "POST_CAPTURE_RUN_SET_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_duplicate_asset_id_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["assets"][1]["id"] = payload["assets"][0]["id"]
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "DUPLICATE_ASSET_IDS"
            ):
                verifier.verify_goal_artifacts(root)

    def test_contradictory_triage_winner_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            run = next(
                item
                for item in payload["postCaptureRuns"]
                if item["id"] == "reception-captured-quality-triage-2026-07-18"
            )
            run["status"] = "quality_is_winner"
            run["metrics"]["winner"] = "quality"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "TRIAGE_RUN_STATUS_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_arbitrary_triage_canonical_hash_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            run = next(
                item
                for item in payload["postCaptureRuns"]
                if item["id"] == "reception-captured-quality-triage-2026-07-18"
            )
            run["canonicalReport"]["reportSha256"] = "0" * 64
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "TRIAGE_CANONICAL_RECEIPT_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_local_route_boundary_overstatement_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            run = next(
                item
                for item in payload["postCaptureRuns"]
                if item["id"] == "reception-local-real-component-2026-07-16"
            )
            run["routeBoundary"]["arbitraryAssetUrlAccepted"] = True
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "LOCAL_RUN_ROUTE_OVERSTATED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_duplicate_post_capture_run_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["postCaptureRuns"].append(payload["postCaptureRuns"][0])
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(verifier.VerificationError, "DUPLICATE_VALUES"):
                verifier.verify_goal_artifacts(root)

    def test_missing_feature_coverage_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            del payload["requiredManualViews"]["featureStageCoverage"]
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(verifier.VerificationError, "EXPECTED_OBJECT"):
                verifier.verify_goal_artifacts(root)

    def test_protected_reference_claim_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["currentInterpretation"]["protectedReferencesReadForThisReconciliation"] = True
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError,
                "FIXED_VIEW_PROTECTED_REFERENCE_BOUNDARY_MISSING",
            ):
                verifier.verify_goal_artifacts(root)

    def test_stale_top_level_next_capture_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["nextCapture"] = "Run a generic moving test."
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "FIXED_VIEW_NEXT_ACTION_STALE"
            ):
                verifier.verify_goal_artifacts(root)

    def test_null_asset_metadata_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["assets"][0]["path"] = None
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(verifier.VerificationError, "EXPECTED_TEXT"):
                verifier.verify_goal_artifacts(root)

    def test_malformed_pipeline_object_is_controlled_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["pipelineAudit"] = []
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(verifier.VerificationError, "EXPECTED_OBJECT"):
                verifier.verify_goal_artifacts(root)

    def test_label_only_raw_audit_row_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            label = payload["rawGoNoGo"]["items"][0]["item"]
            payload["rawGoNoGo"]["items"][0] = {"item": label}
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(verifier.VerificationError, "EXPECTED_TEXT"):
                verifier.verify_goal_artifacts(root)

    def test_external_report_hash_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["currentQualityReconciliation"]["noReferenceIqa"][
                "reportSha256"
            ] = "0" * 64
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "REPORT_RECEIPT_SHA256_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_boolean_asset_size_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["assets"][0]["sizeBytes"] = True
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(verifier.VerificationError, "INVALID_ASSET_SIZE"):
                verifier.verify_goal_artifacts(root)

    def test_duplicate_approach_id_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["decisionMatrix"]
            text = path.read_text(encoding="utf-8")
            text = text.replace("### R2 —", "### R1 —", 1)
            path.write_text(text, encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "DUPLICATE_APPROACH_ID"
            ):
                verifier.verify_goal_artifacts(root)

    def test_current_criteria_body_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["rootReport"]
            text = path.read_text(encoding="utf-8")
            heading = "## 23. 2026-07-22 CURRENT DECISION RECONCILIATION"
            prefix, current = text.split(heading, 1)
            current = current.replace(
                "| A. Dominant-loss diagnosis | **Partial.**",
                "| A. Dominant-loss diagnosis | No audit evidence |",
                1,
            )
            text = prefix + heading + current
            path.write_text(text, encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "CURRENT_CRITERION_ROW_MISSING"
            ):
                verifier.verify_goal_artifacts(root)

    def test_historical_success_audit_marker_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["rootReport"]
            text = path.read_text(encoding="utf-8")
            text = text.replace(
                "Historical assessment — use Section 23 for the current A–I status.",
                "Current assessment.",
                1,
            )
            path.write_text(text, encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "HISTORICAL_AUDIT_MARKER_MISSING"
            ):
                verifier.verify_goal_artifacts(root)

    def test_screenshot_receipt_set_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["screenshotIntegrity"][0]["bytes"] += 1
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "SCREENSHOT_RECEIPT_SET_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_replay_procedure_without_pause_guard_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["replayProcedure"]["runRule"] = "Run the three servers now."
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "REPLAY_PROCEDURE_UNSAFE"
            ):
                verifier.verify_goal_artifacts(root)

    def test_rogue_post_capture_winner_run_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["postCaptureRuns"].append(
                {"id": "rogue-quality-run", "status": "quality_is_current_winner"}
            )
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "POST_CAPTURE_RUN_SET_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_current_interpretation_winner_claim_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["currentInterpretation"]["nextDecisiveCapture"] = (
                "Quality is the current winner and is authorized for promotion."
            )
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "CURRENT_INTERPRETATION_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_completed_cross_context_claim_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["requiredCrossContextViews"]["status"] = "complete"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "CROSS_CONTEXT_STATUS_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_extra_current_winner_field_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["currentQualityReconciliation"]["winner"] = "quality"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "CURRENT_RECONCILIATION_FIELDS_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_extra_current_authorization_field_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["currentQualityReconciliation"]["authorizedNow"] = True
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "CURRENT_RECONCILIATION_FIELDS_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_plausible_asset_receipt_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["assets"][0]["sizeBytes"] += 1
            payload["assets"][0]["sha256"] = "a" * 64
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "ASSET_RECEIPT_SET_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_self_attested_triage_file_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            fixed_path = root / verifier.REQUIRED_ARTIFACTS["fixedViews"]
            payload = json.loads(fixed_path.read_text(encoding="utf-8"))
            run = next(
                item
                for item in payload["postCaptureRuns"]
                if item["id"] == "reception-captured-quality-triage-2026-07-18"
            )
            evidence_path = root / run["evidenceRef"]
            evidence_path.write_text(
                evidence_path.read_text(encoding="utf-8") + "\n",
                encoding="utf-8",
            )
            run["sourceFileReceipts"]["evidenceSha256"] = verifier._sha256(
                evidence_path
            )
            fixed_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "TRIAGE_SOURCE_HASH_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_source_photo_safety_boundary_mutations_are_rejected(self) -> None:
        mutations = (
            ("schemaVersion", "venviewer.reception-source-photo-comparison-evidence.v0"),
            ("status", "heldout_physical_comparison"),
            ("sourceViewDecisionAuthority", "selects_quality"),
            ("heldoutExecutionAvailable", True),
            ("trustedHeldoutRunnerAllowlistEmpty", False),
            ("realVenviewerTelemetryWired", False),
            ("realReceptionRunCompleted", True),
            ("productWinnerEnabled", True),
            ("receiptsAreIndependentAuthentication", True),
        )
        for field, value in mutations:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                root = self._fixture(temporary)
                self._assert_json_mutation_rejected(
                    root,
                    "evidence",
                    ("sourcePhotoComparisonV0", field),
                    value,
                    "SOURCE_PHOTO_SAFETY_BOUNDARY_CHANGED",
                )

    def test_source_photo_test_count_mutations_are_rejected(self) -> None:
        mutations = (
            (("scorer", "passingGeneratedTests"), 35),
            (("scorer", "passingGeneratedTests"), 34.0),
            (("browserHelper", "passingGeneratedFixtureTests"), 20),
        )
        for tail, value in mutations:
            with self.subTest(field=tail[-1], value=value), tempfile.TemporaryDirectory() as temporary:
                root = self._fixture(temporary)
                self._assert_json_mutation_rejected(
                    root,
                    "evidence",
                    ("sourcePhotoComparisonV0", *tail),
                    value,
                    "SOURCE_PHOTO_TEST_COUNTS_CHANGED",
                )

    def test_prepared_local_safety_boundary_mutations_are_rejected(self) -> None:
        mutations = (
            ("schemaVersion", "venviewer.reception-prepared-local-comparison.v0"),
            ("asOf", "2026-07-21"),
            ("authority", "product"),
            ("evidenceRecord", "docs/reports/other.json#unsafe"),
            ("sourceViewDecisionAuthority", "selects_mobile"),
            ("scorerPassingGeneratedTests", 35),
            ("browserHelperPassingGeneratedFixtureTests", 20),
            ("realVenviewerTelemetryWired", False),
            ("heldoutExecutionAvailable", True),
            ("trustedHeldoutRunnerAllowlistEmpty", False),
            ("realReceptionRunCompleted", True),
            ("productWinnerEnabled", True),
            ("receiptsAreIndependentAuthentication", True),
            ("lccReadOrResumed", True),
            ("protectedReferencePixelsRead", True),
            ("cloudPaidDeployOrPublicationAction", True),
        )
        for field, value in mutations:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                root = self._fixture(temporary)
                self._assert_json_mutation_rejected(
                    root,
                    "fixedViews",
                    ("preparedLocalComparison", field),
                    value,
                    "PREPARED_LOCAL_COMPARISON_BOUNDARY_CHANGED",
                )

    def test_new_self_description_fields_are_required(self) -> None:
        cases = (
            ("evidence", ("sourcePhotoComparisonV0", "schemaVersion"), "SOURCE_PHOTO_FIELDS_CHANGED"),
            ("evidence", ("sourcePhotoComparisonV0", "rendererCapture"), "SOURCE_PHOTO_FIELDS_CHANGED"),
            ("fixedViews", ("preparedLocalComparison", "schemaVersion"), "PREPARED_LOCAL_COMPARISON_FIELDS_CHANGED"),
            ("fixedViews", ("preparedLocalComparison", "asOf"), "PREPARED_LOCAL_COMPARISON_FIELDS_CHANGED"),
            ("fixedViews", ("preparedLocalComparison", "authority"), "PREPARED_LOCAL_COMPARISON_FIELDS_CHANGED"),
            ("fixedViews", ("preparedLocalComparison", "evidenceRecord"), "PREPARED_LOCAL_COMPARISON_FIELDS_CHANGED"),
            ("fixedViews", ("preparedLocalComparison", "lccReadOrResumed"), "PREPARED_LOCAL_COMPARISON_FIELDS_CHANGED"),
            ("fixedViews", ("preparedLocalComparison", "protectedReferencePixelsRead"), "PREPARED_LOCAL_COMPARISON_FIELDS_CHANGED"),
            ("fixedViews", ("preparedLocalComparison", "cloudPaidDeployOrPublicationAction"), "PREPARED_LOCAL_COMPARISON_FIELDS_CHANGED"),
        )
        for artifact, keys, code in cases:
            with self.subTest(field=keys[-1]), tempfile.TemporaryDirectory() as temporary:
                root = self._fixture(temporary)
                self._assert_json_field_removed_rejected(root, artifact, keys, code)

    def test_source_photo_support_receipt_mutations_are_rejected(self) -> None:
        mutations = (
            (("scorer", "path"), "tools/reception-hd/run_source_photo_capture.mjs", "PATH"),
            (("scorer", "sizeBytes"), 1, "SIZE"),
            (("scorer", "sha256"), "0" * 64, "SHA256"),
        )
        for tail, value, code in mutations:
            with self.subTest(field=tail[-1]), tempfile.TemporaryDirectory() as temporary:
                root = self._fixture(temporary)
                self._assert_json_mutation_rejected(
                    root,
                    "evidence",
                    ("sourcePhotoComparisonV0", *tail),
                    value,
                    f"SUPPORT_ARTIFACT_{code}_CHANGED",
                )

    def test_renderer_capture_boundary_mutations_are_rejected(self) -> None:
        mutations = (
            ("developmentRealComponentRouteWired", False),
            ("runtimeEnvironmentBoundToPlanPerRun", False),
            ("runtimeInputBytesRecheckedPerFrame", False),
            ("runtimeInputSetReenumeratedBeforeAndAfterEachFrame", False),
            ("runtimeInputSetChangesRejected", False),
            ("installedRuntimeVersionsRecheckedPerFrame", False),
            ("liveCodeUpdatesBlocked", False),
            ("savedFrameEvidenceRecomputable", False),
            ("runtimeBuildInputCount", 22),
            ("runtimeBuildDigest", "0" * 64),
            ("runtimeEnvironmentDigest", "0" * 64),
        )
        for field, value in mutations:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                root = self._fixture(temporary)
                self._assert_json_mutation_rejected(
                    root, "evidence", ("sourcePhotoComparisonV0", "rendererCapture", field),
                    value, "RENDERER_CAPTURE_BOUNDARY_CHANGED",
                )

    def test_renderer_capture_support_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            relative = verifier.EXPECTED_RENDERER_CAPTURE_SUPPORT_ARTIFACTS["captureAdapter"]["path"]
            path = root / relative
            path.write_bytes(path.read_bytes() + b"\n")
            with self.assertRaisesRegex(
                verifier.VerificationError, "SUPPORT_ARTIFACT_SIZE_MISMATCH"
            ):
                verifier.verify_goal_artifacts(root)

    def test_renderer_runtime_environment_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            self._assert_json_mutation_rejected(
                root,
                "evidence",
                ("sourcePhotoComparisonV0", "rendererCapture", "runtimeEnvironment", "mobileOrigin"),
                "http://127.0.0.1:5199",
                "RUNTIME_ENVIRONMENT_CHANGED",
            )

    def test_runtime_build_input_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            relative = Path("packages/web/src/pages/living-hall/LivingHallPage.tsx")
            path = root / relative
            path.write_bytes(path.read_bytes() + b"\n")
            with self.assertRaisesRegex(
                verifier.VerificationError, "RUNTIME_BUILD_DIGEST_MISMATCH"
            ):
                verifier.verify_goal_artifacts(root)

    def test_new_runtime_build_input_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            added = root / "packages/web/src/new-runtime-input.ts"
            added.write_text("export {};\n", encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "RENDERER_CAPTURE_BOUNDARY_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_javascript_and_python_runtime_manifests_match(self) -> None:
        script = """
import('./packages/web/scripts/reception-capture-runtime-build-digest.mjs').then((module) => {
  const root = process.argv[1];
  process.stdout.write(JSON.stringify({
    digest: module.computeReceptionCaptureRuntimeBuildDigest(root),
    environmentDigest: module.computeReceptionCaptureRuntimeEnvironmentDigest({}),
    inputs: module.receptionCaptureRuntimeBuildInputs(root),
  }));
});
"""
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", script, str(REPO_ROOT)],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        javascript = json.loads(completed.stdout)
        self.assertEqual(
            javascript["inputs"],
            list(verifier._reception_capture_runtime_build_inputs(REPO_ROOT)),
        )
        self.assertEqual(
            javascript["digest"],
            verifier._reception_capture_runtime_build_digest(REPO_ROOT),
        )
        self.assertEqual(
            javascript["environmentDigest"],
            verifier._reception_capture_runtime_environment_digest(
                verifier.EXPECTED_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT
            ),
        )

    def test_copied_support_artifact_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            relative = verifier.EXPECTED_SOURCE_PHOTO_SUPPORT_ARTIFACTS["scorer"]["path"]
            path = root / relative
            mutated = bytearray(path.read_bytes())
            mutated[0] ^= 1
            path.write_bytes(mutated)
            with self.assertRaisesRegex(
                verifier.VerificationError, "SUPPORT_ARTIFACT_SHA256_MISMATCH"
            ):
                verifier.verify_goal_artifacts(root)

    def test_self_attested_support_artifact_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            relative = verifier.EXPECTED_SOURCE_PHOTO_SUPPORT_ARTIFACTS["scorer"]["path"]
            support_path = root / relative
            mutated = bytearray(support_path.read_bytes())
            mutated[-1] ^= 1
            support_path.write_bytes(mutated)
            evidence_path = root / verifier.REQUIRED_ARTIFACTS["evidence"]
            payload = json.loads(evidence_path.read_text(encoding="utf-8"))
            payload["sourcePhotoComparisonV0"]["scorer"]["sha256"] = verifier._sha256(
                support_path
            )
            evidence_path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                verifier.VerificationError, "SUPPORT_ARTIFACT_SHA256_CHANGED"
            ):
                verifier.verify_goal_artifacts(root)

    def test_current_action_cannot_enable_heldout_execution(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = self._fixture(temporary)
            self._assert_json_mutation_rejected(
                root,
                "evidence",
                ("currentQualityReconciliation", "currentAction", "heldoutExecutionAvailable"),
                True,
                "EVIDENCE_ACTION_HELDOUT_BOUNDARY_MISMATCH",
            )

    def test_repo_path_traversal_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(
                verifier.VerificationError, "REPO_PATH_TRAVERSAL"
            ):
                verifier._verify_repo_file(root, "../outside", "0" * 64, "test")

    def test_current_winner_claim_added_to_markdown_is_rejected(self) -> None:
        for artifact in ("rootReport", "decisionMatrix", "strategyPatch"):
            with self.subTest(artifact=artifact), tempfile.TemporaryDirectory() as temporary:
                root = self._fixture(temporary)
                path = root / verifier.REQUIRED_ARTIFACTS[artifact]
                path.write_text(
                    path.read_text(encoding="utf-8")
                    + "\nQuality is the current winner and is authorized now.\n",
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(
                    verifier.VerificationError, "ARTIFACT_SHA256_MISMATCH"
                ):
                    verifier.verify_goal_artifacts(root)


if __name__ == "__main__":
    unittest.main()
