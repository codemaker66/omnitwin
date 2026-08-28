from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT_ROOT = Path(__file__).resolve().parents[1]
VERIFIER_FILE = SCRIPT_ROOT / "verify_grand_hall_authority_none_icp_environment_lock.py"
LOCK_FILE = SCRIPT_ROOT / "requirements-grand-hall-authority-none-icp-replay.lock.json"
MODULE_SPEC = importlib.util.spec_from_file_location("grand_hall_icp_environment_lock_verifier", VERIFIER_FILE)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError("Could not load the Grand Hall ICP environment-lock verifier.")
verifier = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(verifier)


class GrandHallAuthorityNoneIcpEnvironmentLockTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_shipped_lock_is_exact_and_non_authoritative(self) -> None:
        document = verifier.verify_lock_document(LOCK_FILE)
        determinism = document["determinism"]
        boundary = document["verificationBoundary"]

        self.assertEqual(document["authority"], "none")
        self.assertEqual(determinism["classification"], "same_runtime_same_host_only")
        self.assertFalse(determinism["crossHostExactReplayClaimed"])
        self.assertFalse(determinism["crossPlatformExactReplayClaimed"])
        self.assertFalse(boundary["executesSourceData"])
        self.assertFalse(boundary["importsLockedWheels"])
        self.assertFalse(boundary["launchesListedRuntimeArtifacts"])
        self.assertFalse(boundary["networkRequired"])

    def test_lock_persists_no_machine_location_secret_or_timestamp(self) -> None:
        document = verifier.verify_lock_document(LOCK_FILE)
        lock_text = LOCK_FILE.read_text(encoding="utf-8")
        boundary = document["verificationBoundary"]

        self.assertFalse(boundary["hostIdentityPersisted"])
        self.assertFalse(boundary["inspectedLocationsPersisted"])
        for forbidden in ("C:\\", "F:\\", "AppData", '"secret"', '"token"', '"timestamp"', '"createdAt"'):
            self.assertNotIn(forbidden, lock_text)

    def test_runtime_and_wheel_byte_pins_match_the_reviewed_inventory(self) -> None:
        document = verifier.verify_lock_document(LOCK_FILE)
        runtime = document["runtime"]
        runtime_members = runtime["members"]
        wheels = document["wheels"]

        self.assertEqual(
            [(item["memberName"], item["byteLength"], item["sha256"]) for item in runtime_members],
            [
                ("python.exe", 104928, "91566dc8bb9a336c36c607ee0d5a5135e54ddce2418e2cd7728a49c8f098904a"),
                ("python313.dll", 6124376, "dd05f134a2f8126a8cfe8d797b87fa966537b894dd49f93336566f9e8d21d4bd"),
                ("vcruntime140.dll", 120400, "052ad6a20d375957e82aa6a3c441ea548d89be0981516ca7eb306e063d5027f4"),
                ("vcruntime140_1.dll", 49776, "6a99bc0128e0c7d6cbbf615fcc26909565e17d4ca3451b97f8987f9c6acbc6c8"),
            ],
        )
        self.assertEqual(
            [(item["distribution"], item["version"], item["byteLength"], item["sha256"]) for item in wheels],
            [
                ("networkx", "3.6.1", 2068504, "d47fbf302e7d9cbbb9e2555a0d267983d2aa476bac30e90dfbe5669bd57f3762"),
                ("numpy", "2.4.2", 12310848, "7df2de1e4fba69a51c06c28f5a3de36731eb9639feb8e1cf7e4a7b0daf4cf622"),
                ("scipy", "1.17.0", 36287211, "87b411e42b425b84777718cc41516b8a7e0795abfa8e8e1d573bf0ef014f0812"),
                ("trimesh", "4.11.2", 740328, "25e3ab2620f9eca5c9376168c67aabdd32205dad1c4eea09cd45cd4a3edf775a"),
            ],
        )

    def test_semantic_pin_allows_formatting_change_but_rejects_content_change(self) -> None:
        document = verifier.verify_lock_document(LOCK_FILE)
        reformatted = self.root / "reformatted.json"
        reformatted.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
        self.assertEqual(verifier.verify_lock_document(reformatted), document)

        document["authority"] = "accepted"
        tampered = self.root / "tampered.json"
        tampered.write_text(json.dumps(document), encoding="utf-8")
        with self.assertRaisesRegex(verifier.EnvironmentLockError, "semantic SHA-256"):
            verifier.verify_lock_document(tampered)

    def test_duplicate_json_key_fails_before_semantic_verification(self) -> None:
        duplicate = self.root / "duplicate.json"
        duplicate.write_text('{"authority":"none","authority":"accepted"}', encoding="utf-8")
        with self.assertRaisesRegex(verifier.EnvironmentLockError, "Duplicate JSON key"):
            verifier.verify_lock_document(duplicate)

    def test_listed_member_byte_verification_is_read_only_and_fail_closed(self) -> None:
        member = self.root / "member.bin"
        payload = b"reviewed-environment-member"
        member.write_bytes(payload)
        spec = {
            "byteLength": len(payload),
            "memberName": member.name,
            "sha256": hashlib.sha256(payload).hexdigest(),
        }

        verifier._verify_member_root(self.root, [spec], "fixture")
        member.write_bytes(payload + b"-drift")
        with self.assertRaisesRegex(verifier.EnvironmentLockError, "does not match the reviewed bytes"):
            verifier._verify_member_root(self.root, [spec], "fixture")

    def test_member_names_cannot_escape_the_supplied_root(self) -> None:
        spec = {
            "byteLength": 1,
            "memberName": "../escape.bin",
            "sha256": "0" * 64,
        }
        with self.assertRaisesRegex(verifier.EnvironmentLockError, "must not contain a location component"):
            verifier._verify_member_root(self.root, [spec], "fixture")

    def test_lock_only_cli_summary_contains_no_inspected_location(self) -> None:
        stdout = StringIO()
        stderr = StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exit_code = verifier.main(["--lock", str(LOCK_FILE)])

        summary = json.loads(stdout.getvalue())
        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(summary["authority"], "none")
        self.assertFalse(summary["listedFileBytesVerified"])
        self.assertNotIn(str(LOCK_FILE), stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
