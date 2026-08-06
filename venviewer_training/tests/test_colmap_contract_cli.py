"""Focused tests for the read-only prepared HD dataset CLI."""

from __future__ import annotations

import ast
import builtins
import hashlib
import io
import json
import socket
import subprocess
import sys
import tempfile
import urllib.request
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from venviewer_training import colmap_contract_cli
from venviewer_training.colmap_contract import ColmapContractError
from venviewer_training.tests.fixture_builder import build_valid_colmap_fixture


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CLI_PATH = REPOSITORY_ROOT / "venviewer_training" / "colmap_contract_cli.py"
FORBIDDEN_IMPORT_ROOTS = frozenset(
    {
        "boto3",
        "botocore",
        "google",
        "gsplat",
        "open3d",
        "pycolmap",
        "requests",
        "runpod",
        "subprocess",
        "torch",
    }
)


def _tree_snapshot(root: Path) -> dict[str, tuple[int, str]]:
    return {
        path.relative_to(root).as_posix(): (
            path.stat().st_size,
            hashlib.sha256(path.read_bytes()).hexdigest(),
        )
        for path in sorted(root.rglob("*"), key=lambda item: item.as_posix())
        if path.is_file()
    }


class PreparedHdDatasetCliTests(unittest.TestCase):
    def _invoke(self, package_root: Path) -> tuple[int, str, str]:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            status = colmap_contract_cli.main(
                ["--package-root", str(package_root)]
            )
        return status, stdout.getvalue(), stderr.getvalue()

    def test_success_emits_versioned_envelope_with_existing_summary(self) -> None:
        with tempfile.TemporaryDirectory(prefix="colmap-cli-success-") as temporary:
            package_root = Path(temporary)
            build_valid_colmap_fixture(package_root)
            status, stdout, stderr = self._invoke(package_root)

        self.assertEqual(status, 0)
        self.assertEqual(stderr, "")
        self.assertTrue(stdout.endswith("\n"))
        document = json.loads(stdout)
        self.assertEqual(
            set(document), {"ok", "schemaVersion", "summary"}
        )
        self.assertIs(document["ok"], True)
        self.assertEqual(
            document["schemaVersion"], colmap_contract_cli.SCHEMA_VERSION
        )
        summary = document["summary"]
        self.assertEqual(
            summary["schemaVersion"], "omnitwin.colmap-training-contract.v0"
        )
        self.assertEqual(summary["cameraCount"], 2)
        self.assertEqual(summary["imageCount"], 3)
        self.assertEqual(summary["runtimeImageCount"], 3)
        self.assertEqual(summary["point3DCount"], 2)
        self.assertEqual(summary["splits"]["trainCount"], 2)
        self.assertEqual(summary["splits"]["heldoutCount"], 1)
        self.assertEqual(summary["depth"]["priorCount"], 2)
        self.assertIs(summary["depth"]["required"], True)
        self.assertEqual(summary["parserSemantics"]["dataFactor"], 2)
        self.assertEqual(summary["parserSemantics"]["testEvery"], 8)

    def test_equivalent_package_roots_emit_byte_identical_json(self) -> None:
        with tempfile.TemporaryDirectory(prefix="colmap-cli-root-a-") as temporary_a:
            root_a = Path(temporary_a)
            build_valid_colmap_fixture(root_a)
            result_a = self._invoke(root_a)
        with tempfile.TemporaryDirectory(prefix="colmap-cli-root-b-") as temporary_b:
            root_b = Path(temporary_b)
            build_valid_colmap_fixture(root_b)
            result_b = self._invoke(root_b)

        self.assertEqual(result_a, result_b)
        self.assertEqual(result_a[0], 0)
        self.assertNotIn("colmap-cli-root-a-", result_a[1])
        self.assertNotIn("colmap-cli-root-b-", result_b[1])

    def test_validation_rejection_is_stable_safe_json(self) -> None:
        with tempfile.TemporaryDirectory(prefix="colmap-cli-reject-") as temporary:
            package_root = Path(temporary)
            _, depth_root = build_valid_colmap_fixture(package_root)
            (depth_root / "train-a.npz").unlink()
            first = self._invoke(package_root)
            second = self._invoke(package_root)

        self.assertEqual(first, second)
        status, stdout, stderr = first
        self.assertEqual(status, colmap_contract_cli.VALIDATION_ERROR_EXIT)
        self.assertEqual(stdout, "")
        self.assertTrue(stderr.endswith("\n"))
        document = json.loads(stderr)
        self.assertEqual(set(document), {"error", "ok", "schemaVersion"})
        self.assertIs(document["ok"], False)
        self.assertEqual(
            document["schemaVersion"], colmap_contract_cli.SCHEMA_VERSION
        )
        self.assertEqual(
            document["error"],
            {
                "code": "MISSING_DEPTH_PRIOR",
                "message": (
                    "Prepared COLMAP package does not satisfy the fixed "
                    "Config-B dataset contract."
                ),
            },
        )

    def test_error_envelope_never_exposes_validator_or_absolute_paths(self) -> None:
        package_root = Path("C:/operator-private/venue-alpha")
        leaked_path = str(package_root / "dataset" / "sparse" / "0" / "cameras.bin")
        with mock.patch.object(
            colmap_contract_cli,
            "validate_colmap_training_contract",
            side_effect=ColmapContractError(
                "READ_FAILED", f"could not read private input {leaked_path}"
            ),
        ):
            status, stdout, stderr = self._invoke(package_root)

        self.assertEqual(status, colmap_contract_cli.VALIDATION_ERROR_EXIT)
        self.assertEqual(stdout, "")
        self.assertEqual(json.loads(stderr)["error"]["code"], "READ_FAILED")
        self.assertNotIn("operator-private", stderr)
        self.assertNotIn("venue-alpha", stderr)
        self.assertNotIn(leaked_path, stderr)

    def test_cli_derives_only_fixed_package_members_and_config_b_parameters(self) -> None:
        package_root = Path("trusted-package")
        summary = {"schemaVersion": "omnitwin.colmap-training-contract.v0"}
        stdout = io.StringIO()
        stderr = io.StringIO()
        with mock.patch.object(
            colmap_contract_cli,
            "validate_colmap_training_contract",
            return_value=summary,
        ) as validator:
            status = colmap_contract_cli.run_package_root(
                package_root, stdout=stdout, stderr=stderr
            )

        self.assertEqual(status, 0)
        self.assertEqual(stderr.getvalue(), "")
        validator.assert_called_once_with(
            package_root / "dataset",
            package_root / "depths",
            depth_required=True,
            data_factor=2,
            test_every=8,
        )
        option_destinations = {
            action.dest
            for action in colmap_contract_cli._parser()._actions
            if action.dest != "help"
        }
        self.assertEqual(option_destinations, {"package_root"})

    def test_success_output_is_bounded_before_any_stdout_is_emitted(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with (
            mock.patch.object(
                colmap_contract_cli,
                "validate_colmap_training_contract",
                return_value={"oversized": "x" * 2_048},
            ),
            mock.patch.object(
                colmap_contract_cli, "MAX_SUCCESS_ENVELOPE_BYTES", 512
            ),
        ):
            status = colmap_contract_cli.run_package_root(
                Path("trusted-package"), stdout=stdout, stderr=stderr
            )

        self.assertEqual(status, colmap_contract_cli.VALIDATION_ERROR_EXIT)
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(json.loads(stderr.getvalue())["error"]["code"], "OUTPUT_TOO_LARGE")

    def test_cli_source_has_no_forbidden_runtime_or_process_imports(self) -> None:
        syntax = ast.parse(CLI_PATH.read_text(encoding="utf-8"))
        imported_roots: set[str] = set()
        for node in ast.walk(syntax):
            if isinstance(node, ast.Import):
                imported_roots.update(alias.name.split(".", 1)[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported_roots.add(node.module.split(".", 1)[0])

        self.assertEqual(imported_roots.intersection(FORBIDDEN_IMPORT_ROOTS), set())

    def test_validation_performs_no_network_process_or_file_mutation(self) -> None:
        with tempfile.TemporaryDirectory(prefix="colmap-cli-readonly-") as temporary:
            package_root = Path(temporary)
            build_valid_colmap_fixture(package_root)
            before = _tree_snapshot(package_root)

            real_builtin_open = builtins.open
            real_io_open = io.open
            real_path_open = Path.open

            def assert_read_mode(mode: str) -> None:
                if any(flag in mode for flag in ("w", "a", "x", "+")):
                    raise AssertionError(f"unexpected write mode: {mode}")

            def guarded_builtin_open(
                file: object, mode: str = "r", *args: object, **kwargs: object
            ):
                assert_read_mode(mode)
                return real_builtin_open(file, mode, *args, **kwargs)

            def guarded_io_open(file: object, mode: str = "r", *args: object, **kwargs: object):
                assert_read_mode(mode)
                return real_io_open(file, mode, *args, **kwargs)

            def guarded_path_open(path: Path, mode: str = "r", *args: object, **kwargs: object):
                assert_read_mode(mode)
                return real_path_open(path, mode, *args, **kwargs)

            with (
                mock.patch.object(builtins, "open", guarded_builtin_open),
                mock.patch.object(io, "open", guarded_io_open),
                mock.patch.object(Path, "open", guarded_path_open),
                mock.patch.object(Path, "mkdir", side_effect=AssertionError("mkdir")),
                mock.patch.object(Path, "rename", side_effect=AssertionError("rename")),
                mock.patch.object(Path, "replace", side_effect=AssertionError("replace")),
                mock.patch.object(Path, "rmdir", side_effect=AssertionError("rmdir")),
                mock.patch.object(Path, "touch", side_effect=AssertionError("touch")),
                mock.patch.object(Path, "unlink", side_effect=AssertionError("unlink")),
                mock.patch.object(Path, "write_bytes", side_effect=AssertionError("write_bytes")),
                mock.patch.object(Path, "write_text", side_effect=AssertionError("write_text")),
                mock.patch.object(socket, "socket") as socket_constructor,
                mock.patch.object(socket, "create_connection") as create_connection,
                mock.patch.object(subprocess, "Popen") as process_constructor,
                mock.patch.object(subprocess, "run") as process_run,
                mock.patch.object(urllib.request, "urlopen") as urlopen,
            ):
                status, stdout, stderr = self._invoke(package_root)

            after = _tree_snapshot(package_root)

        self.assertEqual(status, 0)
        self.assertNotEqual(stdout, "")
        self.assertEqual(stderr, "")
        self.assertEqual(after, before)
        socket_constructor.assert_not_called()
        create_connection.assert_not_called()
        process_constructor.assert_not_called()
        process_run.assert_not_called()
        urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
