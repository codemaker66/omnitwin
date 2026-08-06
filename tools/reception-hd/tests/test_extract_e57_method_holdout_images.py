from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from typing import Any, Callable


MODULE_PATH = Path(__file__).resolve().parents[1] / "extract_e57_method_holdout_images.py"
SPEC = importlib.util.spec_from_file_location("extract_e57_method_holdout_images", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def jpeg(width: int, height: int, tag: int) -> bytes:
    # Synthetic marker stream: SOI, one-byte COM payload, baseline SOF, EOI.
    return (
        b"\xff\xd8\xff\xfe\x00\x03" + bytes([tag]) + b"\xff\xc0\x00\x11\x08"
        + height.to_bytes(2, "big") + width.to_bytes(2, "big")
        + b"\x03\x01\x11\x00\x02\x11\x00\x03\x11\x00\xff\xd9"
    )


def synthetic_contract(source_bytes: bytes) -> tuple[dict[str, Any], dict[int, bytes]]:
    payloads = {760: jpeg(32, 24, 1), 778: jpeg(32, 24, 2), 850: jpeg(32, 24, 3)}
    contract = copy.deepcopy(MODULE.PRODUCTION_CONTRACT)
    contract["source"] = {
        "fileName": "cloud_0.e57", "sizeBytes": len(source_bytes),
        "sha256": hashlib.sha256(source_bytes).hexdigest(),
    }
    for row in contract["images"]:
        payload = payloads[row["image2DIndex"]]
        row.update({
            "sha256": hashlib.sha256(payload).hexdigest(), "sizeBytes": len(payload),
            "width": 32, "height": 24, "fx": 16.0, "fy": 16.0,
            "cx": 16.0, "cy": 12.0,
        })
    return contract, payloads


def protocol_document(contract: dict[str, Any]) -> dict[str, Any]:
    tool_sha = hashlib.sha256(MODULE_PATH.read_bytes()).hexdigest()
    code = {
        key: {"relativePath": path, "sha256": tool_sha if key == "extractor" else "1" * 64}
        for key, path in MODULE.CODE_PATHS.items()
    }
    profiles: dict[str, Any] = {}
    verified_assets: list[dict[str, Any]] = []
    for candidate_index, candidate in enumerate(("quality", "mobile")):
        profile_id = f"{candidate}-synthetic-v1"
        port = 5175 if candidate == "quality" else 4174
        assets: list[dict[str, Any]] = []
        for index in range(4):
            ordinal = candidate_index * 4 + index + 1
            file_name = f"asset-{index}.bin"
            size_bytes = ordinal
            digest = format(ordinal, "064x")
            path = rf"C:\synthetic\{candidate}\{file_name}"
            url = f"http://127.0.0.1:{port}/synthetic/{candidate}/{file_name}"
            asset = {
                "fileName": file_name,
                "path": path,
                "url": url,
                "sizeBytes": size_bytes,
                "sha256": digest,
            }
            assets.append(asset)
            verified_assets.append({
                "candidateId": candidate,
                "profileId": profile_id,
                "fileName": file_name,
                "path": path,
                "url": url,
                "expectedSizeBytes": size_bytes,
                "expectedSha256": digest,
                "disk": {"sizeBytes": size_bytes, "sha256": digest},
                "httpResponse": {
                    "statusCode": 200,
                    "sizeBytes": size_bytes,
                    "sha256": digest,
                    "redirected": False,
                    "contentEncoding": "identity",
                },
            })
        profiles[candidate] = {
            "profileId": profile_id,
            "expectedGaussianCount": 10,
            "assets": assets,
        }
    document: dict[str, Any] = {
        "schemaVersion": MODULE.PROTOCOL_SCHEMA_VERSION,
        "status": "frozen_before_method_specific_holdout_render_scoring",
        "authority": "none", "globallyPristine": False, "roomLabel": "Reception Room",
        "methodScope": "matched_render_method_specific_holdout_only",
        "scanIds": [126, 129, 141], "candidateIds": ["quality", "mobile"],
        "referenceFaceName": "Skybox 4",
        "comparison": {"width": 1024, "height": 1024, "borderPixels": 24},
        "repeatPolicy": {"requiredScanId": 126, "requiredCandidateIds": ["quality", "mobile"],
                         "repeatsForbiddenOnOtherScans": True},
        "referenceJpegs": [
            {"scanId": row["scanId"], "faceName": row["name"], "width": row["width"],
             "height": row["height"], "sizeBytes": row["sizeBytes"], "sha256": row["sha256"]}
            for row in contract["images"]
        ],
        **code,
        "cameraReceipt": {
            "path": r"C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-e57-method-holdout-camera-views-2026-07-17.json",
            "sha256": "2" * 64, "receiptSha256": "3" * 64,
            "schemaVersion": "omnitwin.reception.e57-method-holdout-camera-views.v1",
        },
        "sourceE57": dict(contract["source"]),
        "candidateSourceProfiles": profiles,
        "transformHoldoutReceipt": {
            "path": r"C:\Users\blake\Documents\Codex\2026-07-12\new-chat-2\reception-e57-method-holdout-transform-2026-07-17.json",
            "sha256": "4" * 64, "receiptSha256": "5" * 64,
            "schemaVersion": "omnitwin.reception.e57-method-holdout-transform-evaluation.v1",
        },
        "viewerCode": [
            {"relativePath": relative_path, "sha256": "6" * 64}
            for relative_path in MODULE.VIEWER_CODE_RELATIVE_PATHS
        ],
        "sourceAssetVerificationBeforeCapture": {
            "phase": "before_capture",
            "method": "stream_sha256_disk_and_loopback_http_response_v1",
            "loopbackOnly": True,
            "redirectsAllowed": False,
            "assets": verified_assets,
        },
        "decisionRule": "reuse_compare_matched_renders_directional_rule_v1",
        "priorUseDisclosure": {
            "globallyPristine": False, "july14ImageEvidencePreviouslyUsed": True,
            "july14GeometryEvidencePreviouslyUsed": True,
            "statement": "Scans 126, 129, and 141 appeared in July 14 image and geometry diagnostics; they are held out only from this matched-render comparison method.",
        },
        "permissions": dict(MODULE.PERMISSIONS),
    }
    digest = hashlib.sha256(
        MODULE.PROTOCOL_DIGEST_DOMAIN + MODULE._canonical_json_bytes(document)
    ).hexdigest()
    document["protocolDigest"] = {
        "algorithm": "SHA-256", "domain": MODULE.PROTOCOL_SCHEMA_VERSION,
        "sha256": digest, "isSignature": False,
        "authenticatesCreator": False, "provesTimestamp": False,
    }
    return document


def reseal_protocol(document: dict[str, Any]) -> dict[str, Any]:
    sealed = copy.deepcopy(document)
    sealed.pop("protocolDigest", None)
    digest = hashlib.sha256(
        MODULE.PROTOCOL_DIGEST_DOMAIN + MODULE._canonical_json_bytes(sealed)
    ).hexdigest()
    sealed["protocolDigest"] = {
        "algorithm": "SHA-256", "domain": MODULE.PROTOCOL_SCHEMA_VERSION,
        "sha256": digest, "isSignature": False,
        "authenticatesCreator": False, "provesTimestamp": False,
    }
    return sealed


class Scalar:
    def __init__(self, value: Any) -> None:
        self._value = value

    def value(self) -> Any:
        return self._value


class Blob:
    def __init__(self, payload: bytes, index: int, log: dict[str, list[Any]]) -> None:
        self.payload = payload
        self.index = index
        self.log = log

    def byteCount(self) -> int:
        self.log["byteCounts"].append(self.index)
        return len(self.payload)

    def read(self, target: bytearray, offset: int, count: int) -> int:
        self.log["blobReads"].append((self.index, offset, count))
        if offset != 0 or count != len(self.payload):
            raise AssertionError("extractor requested a partial or oversized blob")
        target[:] = self.payload
        return len(self.payload)


class Node:
    def __init__(self, values: dict[str, Any]) -> None:
        self.values = values

    def __getitem__(self, key: str) -> Any:
        return self.values[key]


class Images:
    def __init__(self, nodes: dict[int, Node], log: dict[str, list[Any]]) -> None:
        self.nodes = nodes
        self.log = log

    def __getitem__(self, index: int) -> Node:
        self.log["imageIndexes"].append(index)
        if index not in self.nodes:
            raise AssertionError(f"unapproved Image2D index {index}")
        return self.nodes[index]


class Root:
    def __init__(self, images: Images, log: dict[str, list[Any]]) -> None:
        self.images = images
        self.log = log

    def __getitem__(self, key: str) -> Images:
        self.log["rootKeys"].append(key)
        if key != "images2D":
            raise AssertionError(f"point data or other root node was accessed: {key}")
        return self.images


class FakeImageFile:
    def __init__(self, root: Root, close_callback: Callable[[], None] | None) -> None:
        self._root = root
        self._close_callback = close_callback

    def root(self) -> Root:
        return self._root

    def close(self) -> None:
        if self._close_callback is not None:
            self._close_callback()


class FakeModule:
    def __init__(self, contract: dict[str, Any], payloads: dict[int, bytes], *,
                 close_callback: Callable[[], None] | None = None,
                 intrinsic_override: tuple[int, str, Any] | None = None) -> None:
        self.opens = 0
        self.log: dict[str, list[Any]] = {
            "rootKeys": [], "imageIndexes": [], "byteCounts": [], "blobReads": []
        }
        nodes: dict[int, Node] = {}
        for expected in contract["images"]:
            index = expected["image2DIndex"]
            representation_values: dict[str, Any] = {
                "imageWidth": Scalar(expected["width"]), "imageHeight": Scalar(expected["height"]),
                "focalLength": Scalar(1.0), "pixelWidth": Scalar(1.0 / expected["fx"]),
                "pixelHeight": Scalar(1.0 / expected["fy"]),
                "principalPointX": Scalar(expected["cx"]), "principalPointY": Scalar(expected["cy"]),
                "jpegImage": Blob(payloads[index], index, self.log),
            }
            if intrinsic_override is not None and intrinsic_override[0] == index:
                representation_values[intrinsic_override[1]] = Scalar(intrinsic_override[2])
            nodes[index] = Node({
                "guid": Scalar(expected["image2DGuid"]),
                "associatedData3DGuid": Scalar(expected["data3DGuid"]),
                "name": Scalar(expected["name"]),
                "pinholeRepresentation": Node(representation_values),
            })
        root = Root(Images(nodes, self.log), self.log)
        self._image_file = FakeImageFile(root, close_callback)

    def E57(self, path: str) -> Any:
        self.opens += 1
        image_file = self._image_file

        class Source:
            pass

        source = Source()
        source.image_file = image_file
        return source


class ExtractorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source_bytes = b"synthetic-e57-source"
        self.contract, self.payloads = synthetic_contract(self.source_bytes)
        self.e57 = self.root / "cloud_0.e57"
        self.e57.write_bytes(self.source_bytes)
        self.protocol = self.root / "protocol.json"
        self.write_protocol(protocol_document(self.contract))
        self.output = self.root / "result"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_protocol(self, document: dict[str, Any]) -> None:
        self.protocol.write_bytes(MODULE._canonical_json_bytes(document) + b"\n")

    def assert_code(self, code: str, callback: Callable[[], Any]) -> None:
        with self.assertRaises(MODULE.ExtractionError) as raised:
            callback()
        self.assertEqual(raised.exception.code, code)

    def run_extract(self, fake: FakeModule) -> tuple[Path, dict[str, Any]]:
        return MODULE.extract_holdout_images(
            self.protocol, self.e57, self.output, contract=self.contract,
            pye57_loader=lambda: fake,
            _test_only_allow_injected_dependencies=True,
        )

    def assert_no_partial_output(self) -> None:
        self.assertFalse(self.output.exists())
        self.assertEqual(
            [path for path in self.root.iterdir() if path.name.startswith(".result.staging-")], []
        )

    def test_exact_three_image_nodes_only_and_atomic_receipt(self) -> None:
        fake = FakeModule(self.contract, self.payloads)
        output, receipt = self.run_extract(fake)
        self.assertEqual(output, self.output)
        self.assertEqual(fake.opens, 1)
        self.assertEqual(fake.log["rootKeys"], ["images2D"])
        self.assertEqual(fake.log["imageIndexes"], [760, 778, 850])
        self.assertEqual(fake.log["byteCounts"], [760, 778, 850])
        self.assertEqual([row[0] for row in fake.log["blobReads"]], [760, 778, 850])
        self.assertEqual(
            {path.name for path in output.iterdir()},
            {"scan-126-skybox-4.jpg", "scan-129-skybox-4.jpg",
             "scan-141-skybox-4.jpg", "extraction-receipt.json"},
        )
        MODULE.verify_extraction_receipt(receipt)
        self.assertTrue(receipt["testOnly"])
        self.assertFalse(receipt["evidenceEligible"])
        self.assertEqual(
            receipt["status"],
            "internal_test_only_injected_dependencies_unusable_as_evidence",
        )
        self.assertIsNone(receipt["scope"]["scanPointDataRead"])
        self.assertIsNone(receipt["scope"]["image2DEnumerationPerformed"])
        self.assertIsNone(receipt["scope"]["exactImage2DIndexesRead"])
        self.assertEqual(
            receipt["scope"]["exactImage2DIndexesRequestedByExtractor"],
            [760, 778, 850],
        )
        self.assertFalse(receipt["scope"]["injectedDependencySideEffectsExcluded"])
        self.assertIn("unusable as production extraction evidence", receipt["limitations"][0])
        self.assertEqual(receipt["permissions"], MODULE.PERMISSIONS)

        relabelled = copy.deepcopy(receipt)
        relabelled.pop("receipt")
        relabelled["status"] = "production_exact_locked_extraction_authority_none"
        relabelled = MODULE._seal_receipt(relabelled)
        self.assert_code(
            "INVALID_EXTRACTION_RECEIPT",
            lambda: MODULE.verify_extraction_receipt(relabelled),
        )

    def test_injected_contract_or_loader_requires_explicit_internal_test_mode(self) -> None:
        fake = FakeModule(self.contract, self.payloads)
        self.assert_code(
            "INJECTED_DEPENDENCIES_FORBIDDEN",
            lambda: MODULE.extract_holdout_images(
                self.protocol,
                self.e57,
                self.output,
                contract=self.contract,
                pye57_loader=lambda: fake,
            ),
        )
        self.assertEqual(fake.opens, 0)
        self.assert_no_partial_output()

    def test_default_dependencies_are_the_only_evidence_eligible_mode(self) -> None:
        test_only, eligible = MODULE._execution_mode(
            MODULE.PRODUCTION_CONTRACT,
            MODULE._default_pye57_loader,
            _test_only_allow_injected_dependencies=False,
        )
        self.assertFalse(test_only)
        self.assertTrue(eligible)

        test_only, eligible = MODULE._execution_mode(
            MODULE.PRODUCTION_CONTRACT,
            MODULE._default_pye57_loader,
            _test_only_allow_injected_dependencies=True,
        )
        self.assertTrue(test_only)
        self.assertFalse(eligible)

        self.assert_code(
            "INJECTED_DEPENDENCIES_FORBIDDEN",
            lambda: MODULE._execution_mode(
                copy.deepcopy(MODULE.PRODUCTION_CONTRACT),
                MODULE._default_pye57_loader,
                _test_only_allow_injected_dependencies=False,
            ),
        )

    def test_protocol_tamper_is_rejected_before_pye57(self) -> None:
        document = json.loads(self.protocol.read_text(encoding="utf-8"))
        document["permissions"]["trainingApproval"] = True
        self.write_protocol(document)
        fake = FakeModule(self.contract, self.payloads)
        self.assert_code("PROTOCOL_DIGEST_MISMATCH", lambda: self.run_extract(fake))
        self.assertEqual(fake.opens, 0)
        self.assert_no_partial_output()

    def test_viewer_code_requires_exact_complete_sorted_capture_chain(self) -> None:
        mutations = (
            lambda rows: rows.pop(),
            lambda rows: rows.append(copy.deepcopy(rows[-1])),
            lambda rows: rows.__setitem__(slice(0, 2), [rows[1], rows[0]]),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                document = protocol_document(self.contract)
                mutate(document["viewerCode"])
                self.write_protocol(reseal_protocol(document))
                fake = FakeModule(self.contract, self.payloads)
                self.assert_code(
                    "PROTOCOL_PIN_MISMATCH",
                    lambda: self.run_extract(fake),
                )
                self.assertEqual(fake.opens, 0)
                self.assert_no_partial_output()

    def test_source_asset_verification_must_match_profiles_disk_and_http(self) -> None:
        mutations = (
            lambda document: document["sourceAssetVerificationBeforeCapture"]["assets"].pop(),
            lambda document: document["sourceAssetVerificationBeforeCapture"]["assets"][0][
                "disk"
            ].update({"sha256": "f" * 64}),
            lambda document: document["sourceAssetVerificationBeforeCapture"]["assets"][4][
                "httpResponse"
            ].update({"redirected": True}),
            lambda document: document["candidateSourceProfiles"]["quality"]["assets"][0].update(
                {"url": "http://127.0.0.1:4174/wrong.sog"}
            ),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                document = protocol_document(self.contract)
                mutate(document)
                self.write_protocol(reseal_protocol(document))
                fake = FakeModule(self.contract, self.payloads)
                self.assert_code(
                    "PROTOCOL_PIN_MISMATCH",
                    lambda: self.run_extract(fake),
                )
                self.assertEqual(fake.opens, 0)
                self.assert_no_partial_output()

    def test_wrong_source_hash_is_rejected_before_pye57(self) -> None:
        self.e57.write_bytes(b"synthetic-e57-sourcf")
        fake = FakeModule(self.contract, self.payloads)
        self.assert_code("E57_SHA256_MISMATCH", lambda: self.run_extract(fake))
        self.assertEqual(fake.opens, 0)
        self.assert_no_partial_output()

    def test_wrong_embedded_jpeg_hash_cleans_staging(self) -> None:
        bad = dict(self.payloads)
        changed = bytearray(bad[778])
        changed[6] ^= 1
        bad[778] = bytes(changed)
        fake = FakeModule(self.contract, bad)
        self.assert_code("JPEG_SHA256_MISMATCH", lambda: self.run_extract(fake))
        self.assert_no_partial_output()

    def test_wrong_intrinsics_cleans_staging(self) -> None:
        fake = FakeModule(self.contract, self.payloads,
                          intrinsic_override=(850, "principalPointX", 15.0))
        self.assert_code("INTRINSICS_MISMATCH", lambda: self.run_extract(fake))
        self.assert_no_partial_output()

    def test_existing_output_is_never_overwritten_or_opened(self) -> None:
        self.output.mkdir()
        sentinel = self.output / "keep.txt"
        sentinel.write_text("keep", encoding="utf-8")
        fake = FakeModule(self.contract, self.payloads)
        self.assert_code("OUTPUT_EXISTS", lambda: self.run_extract(fake))
        self.assertEqual(fake.opens, 0)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")

    def test_source_mutation_after_reads_cleans_staging(self) -> None:
        def mutate() -> None:
            self.e57.write_bytes(b"synthetic-e57-sourcf")

        fake = FakeModule(self.contract, self.payloads, close_callback=mutate)
        self.assert_code("SOURCE_MUTATED", lambda: self.run_extract(fake))
        self.assert_no_partial_output()


if __name__ == "__main__":
    unittest.main()
