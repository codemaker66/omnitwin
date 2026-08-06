"""Regression tests for the authority-none Config B trainer contract.

These tests intentionally stop at input validation and receipt construction.
They never start optimization, contact a provider, or authorize local training.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import urllib.request
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import yaml

import venviewer_training.trainer_contract as trainer_contract
from venviewer_training.colmap_contract import (
    ColmapContractError,
    _jpeg_dimensions,
    resolve_split_image_name,
    validate_colmap_training_contract,
)
from venviewer_training.tests.fixture_builder import (
    _depth_npz_bytes,
    _png_bytes,
    build_valid_colmap_fixture,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPOSITORY_ROOT / "configs" / "training" / "config_b.yaml"
SOURCE_LOCK_PATH = (
    REPOSITORY_ROOT / "venviewer_training" / "gsplat-v1.5.3.source-lock.json"
)
RUNNER_PATH = REPOSITORY_ROOT / "infra" / "runpod" / "run_training.sh"
GITATTRIBUTES_PATH = REPOSITORY_ROOT / ".gitattributes"
DATA_FACTOR = 2
TEST_EVERY = 8

EXPECTED_SOURCE_LOCK_SHA256 = (
    "e9d1ce90702d078f3215951ebb6899ec640f44dbfd7bd5c3742874c5896d748b"
)
EXPECTED_SOURCE_CLOSURE = {
    "examples/datasets/colmap.py": (
        18_447,
        "2aa364ecfd2d7dd715ede5192fccd533982edf3be68b98008440a5aedf3b3fed",
    ),
    "examples/datasets/normalize.py": (
        4_650,
        "019be99afb9cf947842b42c149fb5baecd840847795b0d63e6596d86aa7f79b3",
    ),
    "examples/datasets/traj.py": (
        9_447,
        "69eb03c2b9d04c88bc2d4c4e0a5f398a51b8079889f3aea83775328f455ff936",
    ),
    "examples/gsplat_viewer.py": (
        9_675,
        "c4037793460b1c0fd1f895eed80ba373492136b7c1845f8ddea5f3173838d71a",
    ),
    "examples/lib_bilagrid.py": (
        22_151,
        "fefcebafdf7e8c533fe8c0c83c67a81b010ecc2e4b99677a49528307a306f4b2",
    ),
    "examples/requirements.txt": (
        677,
        "c488a9146f7428560b24cfc7a01455808f356d4c8468641b23277c9236bbcc8a",
    ),
    "examples/simple_trainer.py": (
        49_728,
        "79319e1cd7404e4d1ba0c425634235c39e6054f0643b904a01feea6179462c05",
    ),
    "examples/utils.py": (
        7_519,
        "44a38b236940706705c9351b365be6bd21d49efc57dd695ba5a7e70055b959e1",
    ),
}

EXPECTED_RUNTIME_MODULES = (
    ("torch", "2.4.1"),
    ("gsplat", "1.5.3"),
    ("numpy", "1.26.4"),
    ("yaml", "6.0.2"),
    ("tyro", "0.8.10"),
    ("imageio", None),
    ("viser", None),
    ("nerfview", None),
    ("torchmetrics", None),
    ("tensorboard", None),
    ("cv2", None),
    ("PIL", None),
    ("sklearn", None),
    ("tqdm", None),
    ("pycolmap", None),
    ("scipy", None),
    ("tensorly", None),
    ("matplotlib", None),
    ("typing_extensions", None),
    ("fused_ssim", None),
)

EXPECTED_BINDINGS = {
    "antialiased": "Config.antialiased",
    "app_opt": "Config.app_opt",
    "bilateral_grid_shape": "Config.bilateral_grid_shape",
    "data_factor": "Config.data_factor",
    "depth_lambda": "Config.depth_lambda",
    "depth_loss": "Config.depth_loss",
    "disable_viewer": "Config.disable_viewer",
    "eval_steps": "Config.eval_steps",
    "max_steps": "Config.max_steps",
    "ply_steps": "Config.ply_steps",
    "pose_opt": "Config.pose_opt",
    "post_processing": "Config.use_bilateral_grid",
    "save_ply": "Config.save_ply",
    "save_steps": "Config.save_steps",
    "sh_degree": "Config.sh_degree",
    "strategy.cap_max": "MCMCStrategy.cap_max",
    "strategy.min_opacity": "MCMCStrategy.min_opacity",
    "strategy.noise_injection_stop_iter": "MCMCStrategy.noise_injection_stop_iter",
    "strategy.noise_lr": "MCMCStrategy.noise_lr",
    "strategy.refine_every": "MCMCStrategy.refine_every",
    "strategy.refine_start_iter": "MCMCStrategy.refine_start_iter",
    "strategy.refine_stop_iter": "MCMCStrategy.refine_stop_iter",
    "strategy.type": "Tyro preset mcmc",
    "with_eval3d": "Config.with_eval3d",
    "with_ut": "Config.with_ut",
}

EXPECTED_NORMALIZED_CONFIG = {
    "preset": "mcmc",
    "max_steps": 30_000,
    "save_steps": [
        1_000,
        2_000,
        3_000,
        4_000,
        5_000,
        7_000,
        10_000,
        15_000,
        20_000,
        25_000,
        30_000,
    ],
    "ply_steps": [30_000],
    "eval_steps": [7_000, 15_000, 30_000],
    "sh_degree": 3,
    "antialiased": True,
    "strategy": {
        "type": "MCMCStrategy",
        "cap_max": 5_000_000,
        "noise_lr": 500_000.0,
        "refine_start_iter": 500,
        "refine_stop_iter": 25_000,
        "noise_injection_stop_iter": 24_000,
        "refine_every": 100,
        "min_opacity": 0.005,
        "verbose": True,
    },
    "use_bilateral_grid": True,
    "bilateral_grid_shape": [16, 16, 8],
    "depth_loss": True,
    "depth_lambda": 0.02,
    "with_ut": True,
    "with_eval3d": True,
    "pose_opt": False,
    "app_opt": False,
    "save_ply": True,
    "disable_viewer": True,
    "data_factor": 2,
    "test_every": 8,
    "init_opa": 0.5,
    "init_scale": 0.1,
    "opacity_reg": 0.01,
    "scale_reg": 0.01,
    "strategy_verbose": True,
}

EXPECTED_ARGV = [
    "mcmc",
    "--max-steps",
    "30000",
    "--save-steps",
    "1000",
    "2000",
    "3000",
    "4000",
    "5000",
    "7000",
    "10000",
    "15000",
    "20000",
    "25000",
    "30000",
    "--ply-steps",
    "30000",
    "--eval-steps",
    "7000",
    "15000",
    "30000",
    "--sh-degree",
    "3",
    "--antialiased",
    "--strategy.cap-max",
    "5000000",
    "--strategy.noise-lr",
    "500000.0",
    "--strategy.refine-start-iter",
    "500",
    "--strategy.refine-stop-iter",
    "25000",
    "--strategy.noise-injection-stop-iter",
    "24000",
    "--strategy.refine-every",
    "100",
    "--strategy.min-opacity",
    "0.005",
    "--use-bilateral-grid",
    "--bilateral-grid-shape",
    "16",
    "16",
    "8",
    "--depth-loss",
    "--depth-lambda",
    "0.02",
    "--with-ut",
    "--with-eval3d",
    "--no-pose-opt",
    "--no-app-opt",
    "--save-ply",
    "--disable-viewer",
    "--data-factor",
    "2",
]


def _replace_once(source: bytes, old: str, new: str) -> bytes:
    text = source.decode("utf-8")
    if text.count(old) != 1:
        raise AssertionError(f"expected one occurrence of {old!r}")
    return text.replace(old, new, 1).encode("utf-8")


def _missing_runtime_probe() -> list[dict[str, object]]:
    return [
        {
            "module": "gsplat",
            "available": False,
            "probeExecutedImport": False,
            "probeMethod": "test_fixture",
            "version": None,
            "expectedVersion": "1.5.3",
            "matchesExpected": False,
            "errorType": "ModuleNotFoundError",
        }
    ]


class TrainingConfigContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config_bytes = CONFIG_PATH.read_bytes()

    def assert_config_error(self, config_bytes: bytes, expected_code: str) -> None:
        with self.assertRaises(trainer_contract.TrainerContractError) as raised:
            trainer_contract.normalize_training_config(config_bytes)
        self.assertEqual(raised.exception.code, expected_code)

    def test_checked_in_config_b_normalizes_to_the_frozen_recipe(self) -> None:
        normalized = trainer_contract.normalize_training_config(self.config_bytes)

        self.assertEqual(normalized, EXPECTED_NORMALIZED_CONFIG)

    def test_every_yaml_leaf_has_one_exact_upstream_binding(self) -> None:
        raw = yaml.safe_load(self.config_bytes)
        self.assertIsInstance(raw, dict)
        strategy = raw["strategy"]
        self.assertIsInstance(strategy, dict)
        leaves = (set(raw) - {"strategy"}) | {
            f"strategy.{name}" for name in strategy
        }

        self.assertEqual(leaves, set(EXPECTED_BINDINGS))
        self.assertEqual(trainer_contract.UPSTREAM_BINDINGS, EXPECTED_BINDINGS)

    def test_config_b_compiles_to_the_exact_audited_argv(self) -> None:
        normalized = trainer_contract.normalize_training_config(self.config_bytes)
        argv = trainer_contract.compile_canonical_argv(normalized)

        self.assertEqual(argv, EXPECTED_ARGV)
        for forbidden in trainer_contract.FORBIDDEN_LEGACY_ARGUMENTS:
            self.assertNotIn(forbidden, argv)

    def test_unknown_typo_missing_and_stale_fields_fail_closed(self) -> None:
        cases = {
            "unknown": (
                self.config_bytes + b"unexpected_switch: true\n",
                "UNKNOWN_CONFIG_FIELD",
            ),
            "typo": (
                _replace_once(self.config_bytes, "max_steps: 30000", "max_stepz: 30000"),
                "UNKNOWN_CONFIG_FIELD",
            ),
            "missing": (
                _replace_once(self.config_bytes, "data_factor: 2", ""),
                "MISSING_CONFIG_FIELD",
            ),
            "stale_external_depth": (
                self.config_bytes + b"external_depth_dir: depths_e57\n",
                "UNKNOWN_CONFIG_FIELD",
            ),
            "stale_post_processor": (
                _replace_once(
                    self.config_bytes,
                    "post_processing: bilateral_grid",
                    "post_processing: legacy_bilateral_grid",
                ),
                "UNSUPPORTED_POST_PROCESSING",
            ),
        }
        for name, (config_bytes, expected_code) in cases.items():
            with self.subTest(name=name):
                self.assert_config_error(config_bytes, expected_code)

    def test_duplicate_root_and_strategy_keys_are_rejected(self) -> None:
        root_duplicate = self.config_bytes + b"max_steps: 30000\n"
        strategy_duplicate = _replace_once(
            self.config_bytes,
            "  min_opacity: 0.005",
            "  min_opacity: 0.005\n  cap_max: 5000000",
        )

        self.assert_config_error(root_duplicate, "DUPLICATE_KEY")
        self.assert_config_error(strategy_duplicate, "DUPLICATE_KEY")

    def test_mistyped_values_are_rejected_instead_of_coerced(self) -> None:
        cases = {
            "string_integer": _replace_once(
                self.config_bytes, "max_steps: 30000", 'max_steps: "30000"'
            ),
            "boolean_integer": _replace_once(
                self.config_bytes, "data_factor: 2", "data_factor: true"
            ),
            "string_boolean": _replace_once(
                self.config_bytes, "antialiased: true", 'antialiased: "true"'
            ),
        }
        for name, config_bytes in cases.items():
            with self.subTest(name=name):
                self.assert_config_error(config_bytes, "INVALID_CONFIG_TYPE")

    def test_all_four_frozen_config_b_capabilities_must_remain_enabled(self) -> None:
        cases = {
            "antialiasing": _replace_once(
                self.config_bytes, "antialiased: true", "antialiased: false"
            ),
            "depth_supervision": _replace_once(
                _replace_once(self.config_bytes, "depth_loss: true", "depth_loss: false"),
                "depth_lambda: 0.02",
                "depth_lambda: 0.0",
            ),
            "ut_and_eval3d": _replace_once(
                _replace_once(self.config_bytes, "with_ut: true", "with_ut: false"),
                "with_eval3d: true",
                "with_eval3d: false",
            ),
        }
        for name, config_bytes in cases.items():
            with self.subTest(name=name):
                self.assert_config_error(config_bytes, "INVALID_CONFIG_VALUE")

    def test_disconnected_depth_and_3dgut_fields_have_distinct_errors(self) -> None:
        depth_disconnected = _replace_once(
            self.config_bytes, "depth_loss: true", "depth_loss: false"
        )
        eval_disconnected = _replace_once(
            self.config_bytes, "with_eval3d: true", "with_eval3d: false"
        )

        self.assert_config_error(depth_disconnected, "DISCONNECTED_CONFIG_FIELD")
        self.assert_config_error(eval_disconnected, "DISCONNECTED_CONFIG_FIELD")

    def test_enabled_depth_supervision_requires_positive_weight(self) -> None:
        zero_weight = _replace_once(
            self.config_bytes,
            "depth_lambda: 0.02",
            "depth_lambda: 0.0",
        )

        self.assert_config_error(zero_weight, "INVALID_CONFIG_VALUE")

    def test_otherwise_valid_config_b_value_drift_is_rejected(self) -> None:
        cases = {
            "depth_weight": _replace_once(
                self.config_bytes,
                "depth_lambda: 0.02",
                "depth_lambda: 0.03",
            ),
            "splat_cap": _replace_once(
                self.config_bytes,
                "  cap_max: 5000000",
                "  cap_max: 4000000",
            ),
        }

        for name, config_bytes in cases.items():
            with self.subTest(name=name):
                self.assert_config_error(config_bytes, "CONFIG_B_DRIFT")


class SourceLockContractTests(unittest.TestCase):
    def test_source_lock_pins_exact_archive_license_api_and_source_closure(self) -> None:
        source_bytes = SOURCE_LOCK_PATH.read_bytes()
        source_lock = json.loads(source_bytes)
        closure = {
            entry["path"]: (entry["byteSize"], entry["sha256"])
            for entry in source_lock["requiredSourceClosure"]
        }

        self.assertEqual(hashlib.sha256(source_bytes).hexdigest(), EXPECTED_SOURCE_LOCK_SHA256)
        self.assertEqual(source_lock["schemaVersion"], "venviewer.gsplat-source-lock.v0")
        self.assertEqual(source_lock["project"], "nerfstudio-project/gsplat")
        self.assertEqual(
            source_lock["repository"],
            "https://github.com/nerfstudio-project/gsplat",
        )
        self.assertEqual(source_lock["tag"], "v1.5.3")
        self.assertEqual(
            source_lock["releaseArchive"],
            {
                "url": "https://github.com/nerfstudio-project/gsplat/archive/refs/tags/v1.5.3.tar.gz",
                "byteSize": 27_454_693,
                "sha256": "8a24428b8ea2ce7c3e10fcf5aa20e20fe503b8329c96db797f4eab703729aac3",
            },
        )
        self.assertEqual(
            source_lock["license"],
            {
                "spdx": "Apache-2.0",
                "sourceUrl": "https://raw.githubusercontent.com/nerfstudio-project/gsplat/v1.5.3/LICENSE",
                "byteSize": 11_345,
                "sha256": "96a4f89293c0df19880da9b0e35f67589f5885ea61b224ef16bb2bd599a8a44d",
                "legalReviewStatus": "recorded_not_legal_advice",
            },
        )
        self.assertEqual(closure, EXPECTED_SOURCE_CLOSURE)
        self.assertEqual(
            source_lock["apiContract"],
            {
                "targetPython": "3.10",
                "declaredTyroVersion": "0.8.10",
                "entrypointSignature": "main(local_rank, world_rank, world_size, cfg)",
                "preset": "mcmc",
                "inheritedConfigDefaults": {"test_every": 8},
                "inheritedMcmcDefaults": {
                    "init_opa": 0.5,
                    "init_scale": 0.1,
                    "opacity_reg": 0.01,
                    "scale_reg": 0.01,
                    "strategy.verbose": True,
                },
            },
        )
        self.assertEqual(
            source_lock["runtimeStatus"],
            {
                "sourceVendored": False,
                "dependencyClosurePinned": False,
                "upstreamCliImported": False,
                "externalE57DepthWired": False,
                "trainingMetricsJsonlProduced": False,
                "d014BilateralGridSerializationDefined": False,
                "legacyRunnerEnabled": False,
            },
        )

    def test_contract_loader_records_the_exact_source_lock_digest(self) -> None:
        source_lock, digest = trainer_contract._load_source_lock(SOURCE_LOCK_PATH)

        self.assertEqual(source_lock["tag"], "v1.5.3")
        self.assertEqual(digest, EXPECTED_SOURCE_LOCK_SHA256)

    def test_unsafe_non_file_source_lock_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="source-lock-unsafe-") as temporary:
            unsafe_path = Path(temporary) / "lock.json"
            unsafe_path.mkdir()

            with self.assertRaises(trainer_contract.TrainerContractError) as raised:
                trainer_contract._load_source_lock(unsafe_path)

        self.assertEqual(raised.exception.code, "UNSAFE_FILE")

    def test_fake_source_lock_identity_is_rejected(self) -> None:
        source_lock = json.loads(SOURCE_LOCK_PATH.read_bytes())
        source_lock["releaseArchive"]["sha256"] = "0" * 64
        with tempfile.TemporaryDirectory(prefix="source-lock-fake-") as temporary:
            fake_path = Path(temporary) / "lock.json"
            fake_path.write_text(
                json.dumps(source_lock, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )

            with self.assertRaises(trainer_contract.TrainerContractError) as raised:
                trainer_contract._load_source_lock(fake_path)

        self.assertEqual(raised.exception.code, "INVALID_SOURCE_LOCK")
        self.assertIn("identity is wrong", raised.exception.message)

    def test_source_lock_traversal_path_is_rejected_before_probe(self) -> None:
        source_lock = json.loads(SOURCE_LOCK_PATH.read_bytes())
        source_lock["requiredSourceClosure"][0]["path"] = "../colmap.py"
        with tempfile.TemporaryDirectory(prefix="source-lock-traversal-") as temporary:
            traversal_path = Path(temporary) / "lock.json"
            traversal_path.write_text(
                json.dumps(source_lock, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )

            with self.assertRaises(trainer_contract.TrainerContractError) as raised:
                trainer_contract._load_source_lock(traversal_path)

        self.assertEqual(raised.exception.code, "INVALID_SOURCE_LOCK")
        self.assertIn("path is unsafe", raised.exception.message)

    def test_source_lock_bytes_and_git_attribute_are_lf_pinned(self) -> None:
        source_bytes = SOURCE_LOCK_PATH.read_bytes()
        attributes = GITATTRIBUTES_PATH.read_text(encoding="utf-8").splitlines()

        self.assertNotIn(b"\r", source_bytes)
        self.assertIn(
            "venviewer_training/gsplat-v1.5.3.source-lock.json text eol=lf",
            attributes,
        )


class ColmapFixtureContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="trainer-contract-test-")
        self.addCleanup(self.temporary.cleanup)
        self.dataset_root, self.depth_dir = build_valid_colmap_fixture(
            Path(self.temporary.name)
        )

    def assert_fixture_error(self, expected_code: str) -> None:
        with self.assertRaises(ColmapContractError) as raised:
            validate_colmap_training_contract(
                self.dataset_root,
                self.depth_dir,
                depth_required=True,
                data_factor=DATA_FACTOR,
                test_every=TEST_EVERY,
            )
        self.assertEqual(raised.exception.code, expected_code)

    def test_valid_multicamera_fixture_has_explicit_disjoint_splits_and_depth(self) -> None:
        summary = validate_colmap_training_contract(
            self.dataset_root,
            self.depth_dir,
            depth_required=True,
            data_factor=DATA_FACTOR,
            test_every=TEST_EVERY,
        )

        self.assertEqual(summary["cameraCount"], 2)
        self.assertEqual(summary["imageCount"], 3)
        self.assertEqual(summary["point3DCount"], 2)
        self.assertEqual(
            summary["parserSemantics"],
            {
                "implementation": "gsplat v1.5.3 examples/datasets/colmap.py",
                "dataFactor": DATA_FACTOR,
                "testEvery": TEST_EVERY,
                "splitRule": "sorted_filename_index_modulo_test_every",
                "runtimeImageDirectory": "images_2",
                "extMetadataAccepted": False,
            },
        )
        self.assertEqual(summary["runtimeImageCount"], 3)
        self.assertEqual(summary["splits"]["train"], ["train-a.png", "train-b.png"])
        self.assertEqual(summary["splits"]["heldout"], ["heldout.png"])
        self.assertEqual(summary["depth"]["priorCount"], 2)
        self.assertEqual(
            [item["imageName"] for item in summary["depth"]["priors"]],
            ["train-a.png", "train-b.png"],
        )

    def test_unknown_camera_model_is_rejected(self) -> None:
        cameras_path = self.dataset_root / "sparse" / "0" / "cameras.bin"
        payload = bytearray(cameras_path.read_bytes())
        struct.pack_into("<i", payload, 12, 999)
        cameras_path.write_bytes(payload)

        self.assert_fixture_error("UNKNOWN_CAMERA_MODEL")

    def test_known_non_pinhole_camera_model_is_rejected(self) -> None:
        cameras_path = self.dataset_root / "sparse" / "0" / "cameras.bin"
        payload = bytearray(cameras_path.read_bytes())
        struct.pack_into("<i", payload, 12, 4)
        cameras_path.write_bytes(payload)

        self.assert_fixture_error("UNSUPPORTED_CAMERA_MODEL")

    def test_missing_camera_reference_is_rejected(self) -> None:
        images_path = self.dataset_root / "sparse" / "0" / "images.bin"
        payload = bytearray(images_path.read_bytes())
        struct.pack_into("<i", payload, 68, 999)
        images_path.write_bytes(payload)

        self.assert_fixture_error("MISSING_CAMERA_REFERENCE")

    def test_encoded_image_and_camera_dimension_mismatch_is_rejected(self) -> None:
        (self.dataset_root / "images" / "train-a.png").write_bytes(
            _png_bytes(7, 6, (120, 60, 20))
        )

        self.assert_fixture_error("IMAGE_DIMENSION_MISMATCH")

    def test_missing_registered_image_is_rejected(self) -> None:
        (self.dataset_root / "images" / "train-a.png").unlink()

        self.assert_fixture_error("MISSING_FILE")

    def test_overlapping_train_and_heldout_splits_are_rejected(self) -> None:
        splits = {
            "train": ["train-a.png", "train-b.png", "heldout.png"],
            "heldout": ["heldout.png"],
        }
        (self.dataset_root / "splits.json").write_text(
            json.dumps(splits, separators=(",", ":")) + "\n",
            encoding="utf-8",
            newline="\n",
        )

        self.assert_fixture_error("HELDOUT_LEAKAGE")

    def test_non_exhaustive_splits_are_rejected(self) -> None:
        splits = {"train": ["train-a.png"], "heldout": ["heldout.png"]}
        (self.dataset_root / "splits.json").write_text(
            json.dumps(splits, separators=(",", ":")) + "\n",
            encoding="utf-8",
            newline="\n",
        )

        self.assert_fixture_error("INCOMPLETE_SPLITS")

    def test_disjoint_exhaustive_split_must_match_sorted_modulo_rule(self) -> None:
        splits = {
            "train": ["heldout.png", "train-b.png"],
            "heldout": ["train-a.png"],
        }
        (self.dataset_root / "splits.json").write_text(
            json.dumps(splits, separators=(",", ":")) + "\n",
            encoding="utf-8",
            newline="\n",
        )

        self.assert_fixture_error("SPLIT_SEMANTICS_MISMATCH")

    def test_images_2_must_contain_every_source_image(self) -> None:
        (self.dataset_root / "images_2" / "train-a.png").unlink()

        self.assert_fixture_error("RUNTIME_IMAGE_COUNT_MISMATCH")

    def test_images_2_dimensions_must_be_exactly_half_source_dimensions(self) -> None:
        (self.dataset_root / "images_2" / "train-a.png").write_bytes(
            _png_bytes(5, 3, (120, 60, 20))
        )

        self.assert_fixture_error("RUNTIME_IMAGE_DIMENSION_MISMATCH")

    def test_images_2_sorted_mapping_must_preserve_relative_stems(self) -> None:
        runtime_root = self.dataset_root / "images_2"
        (runtime_root / "train-a.png").rename(runtime_root / "wrong-name.png")

        self.assert_fixture_error("RUNTIME_IMAGE_MAPPING_MISMATCH")

    def test_missing_required_training_depth_is_rejected(self) -> None:
        (self.depth_dir / "train-a.npz").unlink()

        self.assert_fixture_error("MISSING_DEPTH_PRIOR")

    def test_depth_dimensions_must_match_the_corresponding_image(self) -> None:
        (self.depth_dir / "train-a.npz").write_bytes(
            _depth_npz_bytes(
                width=7,
                height=6,
                uv=((1.0, 1.0),),
                depth_m=(2.0,),
            )
        )

        self.assert_fixture_error("DEPTH_DIMENSION_MISMATCH")

    def test_depth_uv_outside_the_image_is_rejected(self) -> None:
        (self.depth_dir / "train-a.npz").write_bytes(
            _depth_npz_bytes(
                width=8,
                height=6,
                uv=((8.0, 1.0),),
                depth_m=(2.0,),
            )
        )

        self.assert_fixture_error("DEPTH_UV_OUT_OF_BOUNDS")

    def test_heldout_depth_prior_is_rejected_as_leakage(self) -> None:
        shutil.copyfile(
            self.depth_dir / "train-b.npz",
            self.depth_dir / "heldout.npz",
        )

        self.assert_fixture_error("HELDOUT_DEPTH_PRIOR")

    def test_depth_prior_filename_case_must_match_for_runpod_linux(self) -> None:
        source = self.depth_dir / "train-a.npz"
        intermediate = self.depth_dir / "case-rename-intermediate.npz"
        source.rename(intermediate)
        intermediate.rename(self.depth_dir / "TRAIN-A.npz")

        self.assert_fixture_error("DEPTH_FILENAME_CASE_MISMATCH")

    def test_split_item_resolves_through_out_of_order_dataset_indices(self) -> None:
        image_names = ["heldout.png", "train-a.png", "train-b.png"]
        train_indices = [2, 1]

        self.assertEqual(
            resolve_split_image_name(image_names, train_indices, 0),
            "train-b.png",
        )
        self.assertEqual(
            resolve_split_image_name(image_names, train_indices, 1),
            "train-a.png",
        )
        with self.assertRaises(ColmapContractError) as raised:
            resolve_split_image_name(image_names, train_indices, 2)
        self.assertEqual(raised.exception.code, "INVALID_SPLIT_ITEM")


class EncodedImageContractTests(unittest.TestCase):
    @staticmethod
    def _valid_jpeg() -> bytes:
        from PIL import Image

        stream = io.BytesIO()
        Image.new("RGB", (10, 8), (20, 40, 60)).save(stream, format="JPEG")
        return stream.getvalue()

    def test_incomplete_trailing_and_decode_invalid_jpegs_are_rejected(self) -> None:
        valid = self._valid_jpeg()
        dht_offset = valid.find(b"\xff\xc4")
        self.assertGreaterEqual(dht_offset, 0)
        corrupt_table = bytearray(valid)
        corrupt_table[dht_offset + 4] = 0xFF
        cases = {
            "incomplete": (valid[:-2], "unterminated JPEG scan"),
            "trailing": (valid + b"trailing", "trailing bytes"),
            "decode_invalid": (bytes(corrupt_table), "pixels could not be decoded"),
        }

        for name, (encoded, message_fragment) in cases.items():
            with self.subTest(name=name):
                with self.assertRaises(ColmapContractError) as raised:
                    _jpeg_dimensions(encoded, "fixture.jpg")
                self.assertEqual(raised.exception.code, "INVALID_IMAGE")
                self.assertIn(message_fragment, raised.exception.message)


class SsimFallbackContractTests(unittest.TestCase):
    def test_positional_padding_train_keyword_and_negative_ssim_are_preserved(self) -> None:
        import torch

        from venviewer_training import ssim_fallback

        checkerboard = torch.tensor(
            [[(row + column) % 2 for column in range(16)] for row in range(16)],
            dtype=torch.float32,
        ).unsqueeze(0)
        inverted = 1.0 - checkerboard

        score = ssim_fallback.fused_ssim(
            checkerboard,
            inverted,
            "valid",
            train=False,
        )

        self.assertLess(float(score), 0.0)
        self.assertGreaterEqual(float(score), -1.000_001)
        documentation = ssim_fallback.__doc__ or ""
        self.assertIn("pinned ``fused_ssim`` callable interface", documentation)
        self.assertIn("do not establish numerical equivalence", documentation)
        self.assertIn("or a performance ratio", documentation)

    def test_train_must_be_a_real_boolean(self) -> None:
        import torch

        from venviewer_training.ssim_fallback import fused_ssim

        image = torch.zeros((1, 1, 11, 11), dtype=torch.float32)
        with self.assertRaisesRegex(TypeError, "train must be boolean"):
            fused_ssim(image, image, "valid", train=1)


class ReceiptAndExecutionBoundaryTests(unittest.TestCase):
    def _build_fixture_receipt(self, fixture_root: Path) -> dict[str, object]:
        dataset_root, depth_dir = build_valid_colmap_fixture(fixture_root)
        with mock.patch.dict(
            os.environ,
            {"VENVIEWER_GSPLAT_SOURCE_ROOT": ""},
            clear=False,
        ):
            return trainer_contract.build_preflight_receipt(
                config_path=CONFIG_PATH,
                dataset_root=dataset_root,
                depth_dir=depth_dir,
                runtime_probe=_missing_runtime_probe,
            )

    def test_missing_runtime_dependency_is_reported_without_crashing(self) -> None:
        def missing_importer(module_name: str) -> object:
            raise ModuleNotFoundError(module_name)

        rows = trainer_contract.probe_runtime_dependencies(importer=missing_importer)

        self.assertEqual(len(rows), len(trainer_contract.RUNTIME_MODULES))
        self.assertTrue(all(row["available"] is False for row in rows))
        self.assertTrue(all(row["probeExecutedImport"] is True for row in rows))
        self.assertTrue(all(row["probeMethod"] == "injected_importer" for row in rows))
        self.assertTrue(all(row["matchesExpected"] is False for row in rows))
        self.assertTrue(all(row["errorType"] == "ModuleNotFoundError" for row in rows))

        with tempfile.TemporaryDirectory(prefix="trainer-receipt-missing-") as temporary:
            receipt = self._build_fixture_receipt(Path(temporary))
        self.assertFalse(receipt["runtimeReady"])
        self.assertEqual(receipt["runtimeDependencies"], _missing_runtime_probe())
        self.assertIn(
            "runtime_dependency_closure_is_not_fully_pinned_or_proven",
            receipt["runtimeBlockers"],
        )

    def test_runtime_module_inventory_includes_the_complete_pinned_import_closure(self) -> None:
        self.assertEqual(trainer_contract.RUNTIME_MODULES, EXPECTED_RUNTIME_MODULES)
        for module_name in (
            "pycolmap",
            "scipy",
            "tensorly",
            "matplotlib",
            "typing_extensions",
            "fused_ssim",
        ):
            self.assertIn(module_name, trainer_contract.RUNTIME_DISTRIBUTIONS)

    def test_default_runtime_probe_uses_metadata_without_import_or_external_io(self) -> None:
        available_modules = {"torch", "PIL", "fused_ssim"}
        versions = {
            "torch": "2.4.1+cu124",
            "Pillow": "10.4.0",
            "fused-ssim": "0.0.0",
        }

        def find_spec(module_name: str) -> object | None:
            return object() if module_name in available_modules else None

        def distribution_version(distribution_name: str) -> str:
            if distribution_name in versions:
                return versions[distribution_name]
            raise trainer_contract.importlib_metadata.PackageNotFoundError(
                distribution_name
            )

        with (
            mock.patch.object(
                trainer_contract.importlib_util,
                "find_spec",
                side_effect=find_spec,
            ),
            mock.patch.object(
                trainer_contract.importlib_metadata,
                "version",
                side_effect=distribution_version,
            ),
            mock.patch.object(socket, "socket") as socket_constructor,
            mock.patch.object(socket, "create_connection") as create_connection,
            mock.patch.object(subprocess, "Popen") as process_constructor,
            mock.patch.object(subprocess, "run") as process_run,
            mock.patch.object(urllib.request, "urlopen") as urlopen,
        ):
            rows = trainer_contract.probe_runtime_dependencies()

        socket_constructor.assert_not_called()
        create_connection.assert_not_called()
        process_constructor.assert_not_called()
        process_run.assert_not_called()
        urlopen.assert_not_called()
        self.assertEqual(len(rows), len(EXPECTED_RUNTIME_MODULES))
        by_module = {row["module"]: row for row in rows}
        for module_name in available_modules:
            self.assertIs(by_module[module_name]["available"], True)
            self.assertIs(by_module[module_name]["probeExecutedImport"], False)
            self.assertEqual(
                by_module[module_name]["probeMethod"],
                "module_spec_and_distribution_metadata",
            )
            self.assertIs(by_module[module_name]["matchesExpected"], True)
        for module_name in set(by_module) - available_modules:
            self.assertIs(by_module[module_name]["available"], False)
            self.assertIs(by_module[module_name]["probeExecutedImport"], False)
            self.assertEqual(by_module[module_name]["errorType"], "ModuleNotFoundError")

    def test_receipt_is_authority_none_and_never_calls_network_or_process_apis(self) -> None:
        with tempfile.TemporaryDirectory(prefix="trainer-receipt-safe-") as temporary:
            dataset_root, depth_dir = build_valid_colmap_fixture(Path(temporary))
            with (
                mock.patch.object(socket, "socket") as socket_constructor,
                mock.patch.object(socket, "create_connection") as create_connection,
                mock.patch.object(subprocess, "Popen") as process_constructor,
                mock.patch.object(subprocess, "run") as process_run,
                mock.patch.object(urllib.request, "urlopen") as urlopen,
                mock.patch.dict(
                    os.environ,
                    {"VENVIEWER_GSPLAT_SOURCE_ROOT": ""},
                    clear=False,
                ),
            ):
                receipt = trainer_contract.build_preflight_receipt(
                    config_path=CONFIG_PATH,
                    dataset_root=dataset_root,
                    depth_dir=depth_dir,
                    runtime_probe=_missing_runtime_probe,
                )

        socket_constructor.assert_not_called()
        create_connection.assert_not_called()
        process_constructor.assert_not_called()
        process_run.assert_not_called()
        urlopen.assert_not_called()
        self.assertEqual(receipt["authority"], "none")
        self.assertEqual(receipt["decision"], "contract_valid_runtime_blocked")
        for field in (
            "actualTraining",
            "modelOptimizationStarted",
            "gpuUsed",
            "networkAccess",
            "providerAccess",
            "objectStorageMutation",
            "d014CandidateProduced",
            "localTrainingAuthorized",
            "runtimeReady",
        ):
            self.assertIs(receipt[field], False, field)

    def test_receipt_is_byte_identical_across_two_fresh_fixture_roots(self) -> None:
        with tempfile.TemporaryDirectory(prefix="trainer-receipt-a-") as temporary_a:
            receipt_a = self._build_fixture_receipt(Path(temporary_a))
        with tempfile.TemporaryDirectory(prefix="trainer-receipt-b-") as temporary_b:
            receipt_b = self._build_fixture_receipt(Path(temporary_b))

        encoded_a = trainer_contract.receipt_bytes(receipt_a)
        encoded_b = trainer_contract.receipt_bytes(receipt_b)
        self.assertEqual(encoded_a, encoded_b)
        self.assertTrue(encoded_a.endswith(b"\n"))
        self.assertNotIn(b"trainer-receipt-a-", encoded_a)
        self.assertNotIn(b"trainer-receipt-b-", encoded_b)

        payload = dict(receipt_a)
        recorded_digest = payload.pop("receiptPayloadSha256")
        actual_digest = hashlib.sha256(
            trainer_contract.canonical_json_bytes(payload)
        ).hexdigest()
        self.assertEqual(recorded_digest, actual_digest)

    def test_help_succeeds_without_importing_training_runtime(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                "-m",
                "venviewer_training.simple_trainer_depth",
                "--help",
            ],
            cwd=REPOSITORY_ROOT,
            capture_output=True,
            check=False,
            text=True,
            timeout=20,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("authority-none CPU contract proof", result.stdout)
        self.assertIn("execute", result.stdout)

        import_probe = subprocess.run(
            [
                sys.executable,
                "-B",
                "-c",
                (
                    "import sys; import venviewer_training.simple_trainer_depth; "
                    "blocked={'torch','gsplat','tyro','viser','nerfview'}; "
                    "print(','.join(sorted(blocked.intersection(sys.modules))))"
                ),
            ],
            cwd=REPOSITORY_ROOT,
            capture_output=True,
            check=False,
            text=True,
            timeout=20,
        )
        self.assertEqual(import_probe.returncode, 0, import_probe.stderr)
        self.assertEqual(import_probe.stdout, "\n")

    def test_execute_command_fails_closed_with_exit_78(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                "-m",
                "venviewer_training.simple_trainer_depth",
                "execute",
                "--",
                "--max-steps",
                "1",
            ],
            cwd=REPOSITORY_ROOT,
            capture_output=True,
            check=False,
            text=True,
            timeout=20,
        )

        self.assertEqual(result.returncode, 78)
        self.assertEqual(result.stdout, "")
        self.assertIn("Actual training is not available", result.stderr)
        self.assertIn("D-016 requires RunPod", result.stderr)

    def test_preflight_refuses_to_overwrite_an_existing_receipt(self) -> None:
        from venviewer_training import simple_trainer_depth

        with tempfile.TemporaryDirectory(prefix="trainer-output-guard-") as temporary:
            output_path = Path(temporary) / "receipt.json"
            original = b"operator-owned existing evidence\n"
            output_path.write_bytes(original)
            arguments = SimpleNamespace(
                synthetic_fixture=True,
                config=CONFIG_PATH,
                dataset=None,
                depth_dir=None,
                output=output_path,
            )
            error_output = io.StringIO()
            with (
                mock.patch.object(
                    trainer_contract,
                    "build_preflight_receipt",
                    return_value={"schemaVersion": "test-only"},
                ),
                mock.patch.object(sys, "stderr", error_output),
            ):
                status = simple_trainer_depth._run_preflight(arguments)

            self.assertEqual(status, 2)
            self.assertEqual(output_path.read_bytes(), original)
            error = json.loads(error_output.getvalue())
            self.assertEqual(error["code"], "OUTPUT_EXISTS")
            self.assertIs(error["ok"], False)

    def test_synthetic_fixture_rejects_an_explicit_depth_directory(self) -> None:
        from venviewer_training import simple_trainer_depth

        arguments = SimpleNamespace(
            synthetic_fixture=True,
            config=CONFIG_PATH,
            dataset=None,
            depth_dir=REPOSITORY_ROOT / "must-not-be-read",
            output=None,
        )
        error_output = io.StringIO()
        with (
            mock.patch.object(
                trainer_contract,
                "build_preflight_receipt",
            ) as build_receipt,
            mock.patch.object(sys, "stderr", error_output),
        ):
            status = simple_trainer_depth._run_preflight(arguments)

        build_receipt.assert_not_called()
        self.assertEqual(status, 2)
        error = json.loads(error_output.getvalue())
        self.assertEqual(error["code"], "INVALID_ARGUMENT")
        self.assertIn("cannot be combined", error["message"])

    def test_legacy_runpod_runner_blocks_before_any_provider_or_training_action(self) -> None:
        runner = RUNNER_PATH.read_text(encoding="utf-8")
        guard_position = runner.index("exit 78")
        first_provider_action = runner.index("rclone lsd")
        first_training_action = runner.index("python -m venviewer_training.simple_trainer_depth")

        self.assertLess(guard_position, first_provider_action)
        self.assertLess(guard_position, first_training_action)
        self.assertIn("No training was started", runner[:guard_position])


if __name__ == "__main__":
    unittest.main()
