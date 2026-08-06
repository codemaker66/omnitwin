from __future__ import annotations

from contextlib import contextmanager
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import numpy as np
from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "compare_method_holdout_renders.py"
SPEC = importlib.util.spec_from_file_location("compare_method_holdout_renders", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


SMALL_COMPARISON = {"width": 96, "height": 96, "borderPixels": 2}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


def save_jpeg(path: Path, pixels: np.ndarray, *, scale: int = 1) -> None:
    image = Image.fromarray(pixels, mode="RGB")
    if scale != 1:
        image = image.resize(
            (pixels.shape[1] * scale, pixels.shape[0] * scale),
            Image.Resampling.NEAREST,
        )
    image.save(path, format="JPEG", quality=95, subsampling=0, optimize=False)


def write_json(path: Path, document: dict[str, object]) -> None:
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def make_synthetic_code_root(root: Path) -> Path:
    code_root = root / "synthetic-repo"
    content_by_path = {
        MODULE.SCORING_DEPENDENCY_RELATIVE_PATH: MODULE.SCORING_DEPENDENCY_PATH.read_bytes(),
        MODULE.WRAPPER_RELATIVE_PATH: MODULE_PATH.read_bytes(),
        MODULE.CAMERA_BUILDER_RELATIVE_PATH: b"# synthetic camera builder\n",
        MODULE.EXTRACTOR_RELATIVE_PATH: b"# synthetic locked extractor\n",
        MODULE.TRANSFORM_EVALUATOR_RELATIVE_PATH: b"# synthetic transform evaluator\n",
    }
    for index, relative_path in enumerate(MODULE.VIEWER_CODE_RELATIVE_PATHS):
        content_by_path[relative_path] = f"synthetic viewer dependency {index}\n".encode()
    for relative_path, content in content_by_path.items():
        target = code_root / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return code_root


def code_entry(code_root: Path, relative_path: str) -> dict[str, str]:
    return {"relativePath": relative_path, "sha256": sha256_file(code_root / relative_path)}


def synthetic_source_asset_verification(phase: str):
    return copy.deepcopy(MODULE._expected_source_asset_verification(phase)), {}


def make_draft(code_root: Path, references: dict[int, dict[str, object]]) -> dict[str, object]:
    return {
        "schemaVersion": MODULE.PROTOCOL_SCHEMA_VERSION,
        "status": MODULE.PROTOCOL_STATUS,
        "authority": "none",
        "globallyPristine": False,
        "roomLabel": "Reception Room",
        "methodScope": MODULE.METHOD_SCOPE,
        "scanIds": [126, 129, 141],
        "candidateIds": ["quality", "mobile"],
        "referenceFaceName": "Skybox 4",
        "comparison": copy.deepcopy(MODULE.EXPECTED_COMPARISON),
        "repeatPolicy": {
            "requiredScanId": 126,
            "requiredCandidateIds": ["quality", "mobile"],
            "repeatsForbiddenOnOtherScans": True,
        },
        "referenceJpegs": [copy.deepcopy(references[scan_id]) for scan_id in (126, 129, 141)],
        "scoringDependency": code_entry(
            code_root, MODULE.SCORING_DEPENDENCY_RELATIVE_PATH
        ),
        "wrapper": code_entry(code_root, MODULE.WRAPPER_RELATIVE_PATH),
        "cameraBuilder": code_entry(code_root, MODULE.CAMERA_BUILDER_RELATIVE_PATH),
        "extractor": code_entry(code_root, MODULE.EXTRACTOR_RELATIVE_PATH),
        "cameraReceipt": copy.deepcopy(MODULE.EXPECTED_CAMERA_RECEIPT),
        "sourceE57": copy.deepcopy(MODULE.EXPECTED_SOURCE_E57),
        "candidateSourceProfiles": copy.deepcopy(
            MODULE.EXPECTED_CANDIDATE_SOURCE_PROFILES
        ),
        "transformHoldoutEvaluator": code_entry(
            code_root, MODULE.TRANSFORM_EVALUATOR_RELATIVE_PATH
        ),
        "transformHoldoutReceipt": copy.deepcopy(MODULE.EXPECTED_TRANSFORM_RECEIPT),
        "viewerCode": [
            code_entry(code_root, relative_path)
            for relative_path in MODULE.VIEWER_CODE_RELATIVE_PATHS
        ],
        "decisionRule": MODULE.DECISION_RULE,
        "priorUseDisclosure": {
            "globallyPristine": False,
            "july14ImageEvidencePreviouslyUsed": True,
            "july14GeometryEvidencePreviouslyUsed": True,
            "statement": (
                "Scans 126, 129, and 141 appeared in July 14 image and geometry "
                "diagnostics; they are held out only from this matched-render "
                "comparison method."
            ),
        },
        "permissions": {
            "physicalApproval": False,
            "runtimePromotionApproval": False,
            "publicReleaseApproval": False,
            "trainingApproval": False,
        },
    }


def capture_evidence(scan_id: int, candidate_id: str, role: str) -> dict[str, object]:
    ordinal = MODULE.CAPTURE_ORDINALS[(scan_id, candidate_id, role)]
    profile = MODULE.EXPECTED_CANDIDATE_SOURCE_PROFILES[candidate_id]
    splat_count = profile["expectedGaussianCount"]
    review_view_id = MODULE._review_view_id(scan_id)
    return {
        "url": MODULE.expected_capture_url(scan_id, candidate_id),
        "captureOrdinal": ordinal,
        "captureId": f"00000000-0000-4000-8000-{ordinal:012x}",
        "viewportMethod": MODULE.CAPTURE_VIEWPORT_METHOD,
        "browserMethod": MODULE.CAPTURE_BROWSER_METHOD,
        "scene": {
            "sceneState": "live",
            "cameraReady": True,
            "loadedSourceCount": 4,
            "loadedSplatCount": splat_count,
            "renderProfileId": MODULE.RENDER_PROFILE_ID,
            "reviewViewId": review_view_id,
            "effectiveDpr": 1,
        },
        "root": {
            "candidateId": candidate_id,
            "runtimeProfileId": profile["profileId"],
            "expectedSplatCount": splat_count,
            "reviewViewId": review_view_id,
        },
        "canvas": {
            "width": 1024,
            "height": 1024,
            "clientWidth": 1024,
            "clientHeight": 1024,
        },
    }


def make_images(root: Path) -> tuple[dict[int, dict[str, object]], list[dict[str, object]]]:
    references: dict[int, dict[str, object]] = {}
    views: list[dict[str, object]] = []
    for scan_id in (126, 129, 141):
        reference_pixels = room_pattern(scan_id)
        reference_path = root / f"scan-{scan_id}-reference.jpg"
        quality_path = root / f"scan-{scan_id}-quality.jpg"
        mobile_path = root / f"scan-{scan_id}-mobile.jpg"
        save_jpeg(reference_path, reference_pixels, scale=2)
        save_jpeg(quality_path, reference_pixels)
        save_jpeg(mobile_path, shifted(reference_pixels, 8))
        references[scan_id] = {
            "scanId": scan_id,
            "faceName": "Skybox 4",
            "width": 192,
            "height": 192,
            "sizeBytes": reference_path.stat().st_size,
            "sha256": sha256_file(reference_path),
        }
        candidates: dict[str, object] = {}
        for candidate_id, main_path in (("quality", quality_path), ("mobile", mobile_path)):
            repeat_binding = None
            if scan_id == 126:
                repeat_path = root / f"scan-{scan_id}-{candidate_id}-repeat.jpg"
                repeat_path.write_bytes(main_path.read_bytes())
                repeat_binding = {
                    "path": repeat_path.name,
                    "sha256": sha256_file(repeat_path),
                    "captureEvidence": capture_evidence(
                        scan_id, candidate_id, "repeat"
                    ),
                }
            candidates[candidate_id] = {
                "render": {
                    "path": main_path.name,
                    "sha256": sha256_file(main_path),
                    "captureEvidence": capture_evidence(
                        scan_id, candidate_id, "render"
                    ),
                },
                "repeat": repeat_binding,
            }
        views.append(
            {
                "scanId": scan_id,
                "reference": {
                    "path": reference_path.name,
                    "sha256": sha256_file(reference_path),
                },
                "candidates": candidates,
            }
        )
    return references, views


@contextmanager
def synthetic_case(root: Path):
    run_root = root / "run"
    run_root.mkdir(parents=True)
    code_root = make_synthetic_code_root(root)
    references, views = make_images(run_root)
    with (
        mock.patch.object(MODULE, "REPOSITORY_ROOT", code_root),
        mock.patch.object(MODULE, "EXPECTED_COMPARISON", copy.deepcopy(SMALL_COMPARISON)),
        mock.patch.object(MODULE, "EXPECTED_REFERENCE_JPEGS", references),
        mock.patch.object(
            MODULE,
            "_verify_candidate_source_assets",
            side_effect=synthetic_source_asset_verification,
        ),
    ):
        draft = make_draft(code_root, references)
        draft_path = run_root / "protocol-draft.json"
        protocol_path = run_root / "protocol.json"
        write_json(draft_path, draft)
        MODULE.freeze_protocol(draft_path, protocol_path)
        manifest = {
            "schemaVersion": MODULE.MANIFEST_SCHEMA_VERSION,
            "authority": "none",
            "captureEncoding": MODULE.CAPTURE_ENCODING,
            "protocol": {
                "path": protocol_path.name,
                "sha256": sha256_file(protocol_path),
            },
            "views": views,
        }
        manifest_path = run_root / "manifest.json"
        write_json(manifest_path, manifest)
        yield SimpleNamespace(
            root=run_root,
            code_root=code_root,
            draft=draft,
            draft_path=draft_path,
            protocol=protocol_path,
            manifest=manifest,
            manifest_path=manifest_path,
            references=references,
        )


class FrozenContractTests(unittest.TestCase):
    def test_cli_truthfully_reports_source_byte_hashing(self) -> None:
        frozen = {
            "status": MODULE.PROTOCOL_STATUS,
            "protocolDigest": {"sha256": "1" * 64},
        }
        with (
            mock.patch.object(MODULE, "freeze_protocol", return_value=frozen),
            mock.patch("builtins.print") as printed,
        ):
            exit_code = MODULE.main(
                ["freeze-protocol", "--draft", "draft.json", "--output", "protocol.json"]
            )
        self.assertEqual(exit_code, 0)
        summary = json.loads(printed.call_args.args[0])
        self.assertIn("byte-hashing all eight candidate source assets", summary["plainLanguage"])
        self.assertIn("No holdout JPEG pixels", summary["plainLanguage"])
        self.assertNotIn("No image, E57, source asset", summary["plainLanguage"])

    def test_production_constants_are_exact_and_scorer_is_imported(self) -> None:
        self.assertEqual(MODULE.SCAN_IDS, (126, 129, 141))
        self.assertEqual(MODULE.CANDIDATE_IDS, ("quality", "mobile"))
        self.assertEqual(
            MODULE.EXPECTED_COMPARISON,
            {"width": 1024, "height": 1024, "borderPixels": 24},
        )
        self.assertEqual(MODULE.CAPTURE_ENCODING, "browser_tab_screenshot_jpeg")
        self.assertEqual(
            MODULE.VIEWER_CODE_RELATIVE_PATHS,
            tuple(sorted(MODULE.VIEWER_CODE_RELATIVE_PATHS)),
        )
        self.assertEqual(len(MODULE.VIEWER_CODE_RELATIVE_PATHS), 16)
        self.assertIs(MODULE.ComparisonError, MODULE.BASE.ComparisonError)
        self.assertEqual(
            MODULE.IMPORTED_SCORING_DEPENDENCY_SHA256,
            sha256_file(MODULE.SCORING_DEPENDENCY_PATH),
        )
        self.assertEqual(MODULE.IMPORTED_WRAPPER_SHA256, sha256_file(MODULE_PATH))

    def test_freeze_is_create_only_and_does_not_open_pixels_or_receipts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            code_root = make_synthetic_code_root(root)
            references = copy.deepcopy(MODULE.EXPECTED_REFERENCE_JPEGS)
            draft = make_draft(code_root, references)
            draft_path = root / "draft.json"
            output = root / "protocol.json"
            write_json(draft_path, draft)
            with (
                mock.patch.object(MODULE, "REPOSITORY_ROOT", code_root),
                mock.patch.object(
                    MODULE.BASE.Image, "open", side_effect=AssertionError("pixel read")
                ),
                mock.patch.object(
                    MODULE,
                    "_verify_candidate_source_assets",
                    side_effect=synthetic_source_asset_verification,
                ) as source_verifier,
            ):
                sealed = MODULE.freeze_protocol(draft_path, output)
                MODULE.validate_protocol(sealed, verify_code=True)
                with self.assertRaises(MODULE.ComparisonError) as raised:
                    MODULE.freeze_protocol(draft_path, output)
            self.assertEqual(raised.exception.code, "OUTPUT_EXISTS")
            self.assertEqual(sealed["authority"], "none")
            self.assertFalse(sealed["globallyPristine"])
            self.assertEqual(len(sealed["protocolDigest"]["sha256"]), 64)
            self.assertEqual(source_verifier.call_args_list[0].args, ("before_capture",))
            self.assertEqual(
                sealed["sourceAssetVerificationBeforeCapture"]["method"],
                MODULE.SOURCE_ASSET_VERIFICATION_METHOD,
            )
            self.assertEqual(
                len(sealed["sourceAssetVerificationBeforeCapture"]["assets"]), 8
            )

    def test_freeze_rejects_unknown_fields_changed_values_and_code_hashes(self) -> None:
        cases = (
            (lambda draft: draft.update({"surprise": True}), "INVALID_OBJECT_KEYS"),
            (lambda draft: draft["comparison"].update({"borderPixels": 23}), "FROZEN_VALUE_MISMATCH"),
            (lambda draft: draft["wrapper"].update({"sha256": "f" * 64}), "CODE_HASH_MISMATCH"),
        )
        for mutate, expected_code in cases:
            with self.subTest(expected_code=expected_code), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                code_root = make_synthetic_code_root(root)
                draft = make_draft(code_root, copy.deepcopy(MODULE.EXPECTED_REFERENCE_JPEGS))
                mutate(draft)
                draft_path = root / "draft.json"
                write_json(draft_path, draft)
                with mock.patch.object(MODULE, "REPOSITORY_ROOT", code_root):
                    with self.assertRaises(MODULE.ComparisonError) as raised:
                        MODULE.freeze_protocol(draft_path, root / "out.json")
                self.assertEqual(raised.exception.code, expected_code)


class SyntheticScoringTests(unittest.TestCase):
    def test_source_asset_verification_failure_stops_before_pixel_scoring(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
            def reject_sources(_phase: str):
                MODULE.fail(
                    "SOURCE_HTTP_HASH_MISMATCH",
                    "synthetic loopback response differs from the frozen source",
                )

            with (
                mock.patch.object(
                    MODULE,
                    "_verify_candidate_source_assets",
                    side_effect=reject_sources,
                ),
                mock.patch.object(
                    MODULE.BASE.Image,
                    "open",
                    side_effect=AssertionError("pixel scoring must not begin"),
                ),
            ):
                with self.assertRaises(MODULE.ComparisonError) as raised:
                    MODULE.evaluate_holdout(case.protocol, case.manifest_path)
            self.assertEqual(raised.exception.code, "SOURCE_HTTP_HASH_MISMATCH")

    def test_quality_gets_directional_lead_with_only_scan_126_repeats(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
            output = case.root / "result.json"
            with (
                mock.patch.object(
                    MODULE.BASE,
                    "_apply_decision",
                    wraps=MODULE.BASE._apply_decision,
                ) as decision,
                mock.patch.object(
                    MODULE.BASE,
                    "_candidate_view_entry",
                    wraps=MODULE.BASE._candidate_view_entry,
                ) as candidate_entry,
            ):
                result = MODULE.score_to_file(case.protocol, case.manifest_path, output)

            self.assertTrue(output.is_file())
            self.assertEqual(result["status"], MODULE.RESULT_STATUS)
            self.assertEqual(result["authority"], "none")
            self.assertFalse(result["globallyPristine"])
            self.assertFalse(result["physicalApproval"])
            self.assertFalse(result["runtimePromotionApproval"])
            self.assertFalse(result["publicReleaseApproval"])
            self.assertFalse(result["trainingApproval"])
            self.assertEqual(
                result["sourceAssetVerificationAfterCapture"]["phase"],
                "after_capture",
            )
            self.assertEqual(
                len(result["sourceAssetVerificationAfterCapture"]["assets"]), 8
            )
            self.assertEqual(
                result["inputEvidence"]["prePixelChainDeclarations"]
                ["sourceAssetVerificationBeforeCapture"]["phase"],
                "before_capture",
            )
            self.assertTrue(result["safety"]["networkUsePerformed"])
            self.assertFalse(result["safety"]["externalNetworkUsePerformed"])
            self.assertEqual(result["captureEncoding"]["decodedFormatRequired"], "JPEG")
            self.assertFalse(result["captureEncoding"]["lossless"])
            self.assertEqual(result["decision"]["status"], "directional_lead")
            self.assertEqual(result["decision"]["candidate"], "quality")
            self.assertEqual(
                result["decision"]["repeatEvidence"]["commonRepeatScanIds"], [126]
            )
            self.assertEqual(
                result["decision"]["repeatEvidence"]["repeatCountByCandidate"],
                {"quality": 1, "mobile": 1},
            )
            capture = result["views"][0]["candidates"]["quality"]["render"][
                "captureEvidence"
            ]
            self.assertEqual(capture["captureOrdinal"], 1)
            self.assertEqual(capture["scene"]["sceneState"], "live")
            self.assertEqual(capture["scene"]["loadedSplatCount"], 2_002_009)
            self.assertEqual(
                capture["browserMethod"], "tab.screenshot({fullPage:true})"
            )
            self.assertEqual(len(result["inputEvidence"]["viewerCode"]), 16)
            self.assertFalse(
                result["safety"][
                    "captureEvidenceCryptographicallyProvesIndependentAcquisition"
                ]
            )
            self.assertEqual(decision.call_count, 1)
            self.assertEqual(candidate_entry.call_count, 6)
            MODULE.verify_result_receipt(result)
            self.assertEqual(
                result["receipt"]["wrapperSha256"],
                result["inputEvidence"]["code"]["wrapper"]["sha256"],
            )

    def test_manifest_rejects_wrong_repeats_scan_ids_hashes_and_unknown_keys(self) -> None:
        mutations = (
            (
                lambda manifest: manifest["views"][0]["candidates"]["quality"].update(
                    {"repeat": None}
                ),
                "REPEAT_REQUIRED",
            ),
            (
                lambda manifest: manifest["views"][1]["candidates"]["quality"].update(
                    {"repeat": copy.deepcopy(manifest["views"][0]["candidates"]["quality"]["repeat"])}
                ),
                "REPEAT_FORBIDDEN",
            ),
            (lambda manifest: manifest["views"][1].update({"scanId": 130}), "FROZEN_VALUE_MISMATCH"),
            (lambda manifest: manifest.update({"extra": 1}), "INVALID_OBJECT_KEYS"),
            (
                lambda manifest: manifest["protocol"].update({"sha256": "0" * 64}),
                "PROTOCOL_FILE_HASH_MISMATCH",
            ),
            (
                lambda manifest: manifest["views"][0]["reference"].update(
                    {"sha256": "0" * 64}
                ),
                "FROZEN_VALUE_MISMATCH",
            ),
            (
                lambda manifest: manifest["views"][2]["candidates"]["mobile"][
                    "render"
                ].update({"sha256": "0" * 64}),
                "IMAGE_HASH_MISMATCH",
            ),
        )
        for mutate, expected_code in mutations:
            with self.subTest(expected_code=expected_code), tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
                manifest = copy.deepcopy(case.manifest)
                mutate(manifest)
                write_json(case.manifest_path, manifest)
                with self.assertRaises(MODULE.ComparisonError) as raised:
                    MODULE.evaluate_holdout(case.protocol, case.manifest_path)
                self.assertEqual(raised.exception.code, expected_code)

    def test_capture_evidence_rejects_wrong_url_telemetry_ordinal_and_copied_id(self) -> None:
        mutations = (
            (
                lambda manifest: manifest["views"][0]["candidates"]["quality"][
                    "render"
                ]["captureEvidence"].update({"url": "http://127.0.0.1:5175/wrong"}),
                "FROZEN_VALUE_MISMATCH",
            ),
            (
                lambda manifest: manifest["views"][1]["candidates"]["mobile"][
                    "render"
                ]["captureEvidence"]["scene"].update({"loadedSourceCount": 3}),
                "FROZEN_VALUE_MISMATCH",
            ),
            (
                lambda manifest: manifest["views"][2]["candidates"]["quality"][
                    "render"
                ]["captureEvidence"].update({"captureOrdinal": 99}),
                "FROZEN_VALUE_MISMATCH",
            ),
            (
                lambda manifest: manifest["views"][0]["candidates"]["quality"][
                    "repeat"
                ]["captureEvidence"].update(
                    {
                        "captureId": manifest["views"][0]["candidates"]["quality"][
                            "render"
                        ]["captureEvidence"]["captureId"]
                    }
                ),
                "DUPLICATE_CAPTURE_ID",
            ),
        )
        for mutate, expected_code in mutations:
            with self.subTest(expected_code=expected_code), tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
                manifest = copy.deepcopy(case.manifest)
                mutate(manifest)
                write_json(case.manifest_path, manifest)
                with self.assertRaises(MODULE.ComparisonError) as raised:
                    MODULE.evaluate_holdout(case.protocol, case.manifest_path)
                self.assertEqual(raised.exception.code, expected_code)

    def test_viewer_code_file_tampering_is_rejected_at_score_time(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
            viewer_path = case.code_root / MODULE.VIEWER_CODE_RELATIVE_PATHS[5]
            viewer_path.write_bytes(viewer_path.read_bytes() + b"tampered\n")
            with self.assertRaises(MODULE.ComparisonError) as raised:
                MODULE.evaluate_holdout(case.protocol, case.manifest_path)
            self.assertEqual(raised.exception.code, "CODE_HASH_MISMATCH")

    def test_rejects_non_jpeg_blank_wrong_dimensions_and_hardlinks(self) -> None:
        cases = ("non_jpeg", "blank", "dimensions", "hardlink")
        for variant in cases:
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
                manifest = copy.deepcopy(case.manifest)
                binding = manifest["views"][1]["candidates"]["mobile"]["render"]
                target = case.root / binding["path"]
                if variant == "non_jpeg":
                    target.write_bytes(b"not an image")
                    expected_codes = {"INVALID_IMAGE"}
                elif variant == "blank":
                    save_jpeg(target, np.full((96, 96, 3), 80, dtype=np.uint8))
                    expected_codes = {"BLANK_IMAGE"}
                elif variant == "dimensions":
                    save_jpeg(target, room_pattern(129), scale=2)
                    expected_codes = {"CANDIDATE_DIMENSIONS_MISMATCH"}
                else:
                    target.unlink()
                    source_binding = manifest["views"][1]["candidates"]["quality"]["render"]
                    source = case.root / source_binding["path"]
                    try:
                        os.link(source, target)
                    except OSError as error:
                        self.skipTest(f"hard links unavailable: {error}")
                    expected_codes = {"DUPLICATE_INPUT_IDENTITY"}
                binding["sha256"] = sha256_file(target)
                write_json(case.manifest_path, manifest)
                with self.assertRaises(MODULE.ComparisonError) as raised:
                    MODULE.evaluate_holdout(case.protocol, case.manifest_path)
                self.assertIn(raised.exception.code, expected_codes)

    def test_rejects_symlinked_image_when_platform_can_create_one(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
            manifest = copy.deepcopy(case.manifest)
            source_binding = manifest["views"][2]["candidates"]["quality"]["render"]
            source = case.root / source_binding["path"]
            linked = case.root / "linked-candidate.jpg"
            try:
                os.symlink(source, linked)
            except OSError as error:
                self.skipTest(f"symbolic links unavailable: {error}")
            mobile_binding = manifest["views"][2]["candidates"]["mobile"]["render"]
            mobile_binding.update({"path": linked.name, "sha256": sha256_file(source)})
            write_json(case.manifest_path, manifest)
            with self.assertRaises(MODULE.ComparisonError) as raised:
                MODULE.evaluate_holdout(case.protocol, case.manifest_path)
            self.assertEqual(raised.exception.code, "SYMLINK_OR_REPARSE_FORBIDDEN")

    def test_protocol_tampering_fails_even_if_manifest_whole_file_hash_is_updated(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
            protocol = json.loads(case.protocol.read_text(encoding="utf-8"))
            protocol["protocolDigest"]["sha256"] = hashlib.sha256(
                b"tampered protocol digest"
            ).hexdigest()
            write_json(case.protocol, protocol)
            manifest = copy.deepcopy(case.manifest)
            manifest["protocol"]["sha256"] = sha256_file(case.protocol)
            write_json(case.manifest_path, manifest)
            with self.assertRaises(MODULE.ComparisonError) as raised:
                MODULE.evaluate_holdout(case.protocol, case.manifest_path)
            self.assertEqual(raised.exception.code, "PROTOCOL_DIGEST_MISMATCH")

    def test_rejects_protocol_and_image_mutation_during_scoring(self) -> None:
        for target_kind in ("protocol", "image"):
            with self.subTest(target_kind=target_kind), tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
                original = MODULE.BASE._apply_decision

                def mutate_after_decision(*args):
                    result = original(*args)
                    if target_kind == "protocol":
                        target = case.protocol
                    else:
                        binding = case.manifest["views"][2]["candidates"]["mobile"]["render"]
                        target = case.root / binding["path"]
                    payload = target.read_bytes()
                    target.write_bytes(payload[:-1] + bytes([payload[-1] ^ 1]))
                    return result

                with mock.patch.object(MODULE.BASE, "_apply_decision", side_effect=mutate_after_decision):
                    with self.assertRaises(MODULE.ComparisonError) as raised:
                        MODULE.evaluate_holdout(case.protocol, case.manifest_path)
                self.assertIn(
                    raised.exception.code,
                    {"FILE_CHANGED_AFTER_USE", "INPUT_CHANGED_AFTER_SCORING"},
                )

    def test_output_is_create_only_and_result_digest_detects_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, synthetic_case(Path(temporary)) as case:
            output = case.root / "result.json"
            result = MODULE.score_to_file(case.protocol, case.manifest_path, output)
            with self.assertRaises(MODULE.ComparisonError) as raised:
                MODULE.score_to_file(case.protocol, case.manifest_path, output)
            self.assertEqual(raised.exception.code, "OUTPUT_EXISTS")
            tampered = copy.deepcopy(result)
            tampered["decision"]["candidate"] = "mobile"
            with self.assertRaises(MODULE.ComparisonError) as digest_error:
                MODULE.verify_result_receipt(tampered)
            self.assertEqual(digest_error.exception.code, "RESULT_DIGEST_MISMATCH")


if __name__ == "__main__":
    unittest.main()
