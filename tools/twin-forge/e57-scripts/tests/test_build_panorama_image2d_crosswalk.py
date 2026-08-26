from __future__ import annotations

from contextlib import redirect_stderr
from dataclasses import replace
import hashlib
from io import StringIO
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

np = None

import build_panorama_image2d_crosswalk as builder
from build_panorama_image2d_crosswalk import DerivedCrosswalk, OpenCvSiftBackend, main, run_check
from panorama_image2d_crosswalk import (
    CandidateVerification,
    DependencyAttestation,
    DependencyPackageAttestation,
    Data3DSource,
    FaceFeature,
    FROZEN_CONFIGURATION,
    FeatureArtifact,
    GeneratorBinding,
    GeneratorFileBinding,
    Intrinsics,
    PanoramaFeature,
    ScanFeature,
    SourceBindings,
    RetrievalScore,
    verify_dependency_lock,
)


def jpeg_bytes(backend: OpenCvSiftBackend, image: np.ndarray) -> bytes:
    success, encoded = backend.cv2.imencode(".jpg", image)
    if not success:
        raise RuntimeError("synthetic JPEG encode failed")
    return encoded.tobytes()


def identity(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class StartupImportAndSealTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary_root = os.environ.get("E57_EVIDENCE_TEST_TMP")
        self.temporary = tempfile.TemporaryDirectory(dir=temporary_root)
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _run_builder_code(self, body: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.pop("PYTHONPATH", None)
        script = Path(builder.__file__).resolve()
        code = (
            "import pathlib,runpy,sys\n"
            f"script=pathlib.Path({str(script)!r})\n"
            "sys.path[0]=str(script.parent)\n"
            f"{body}\n"
            "sys.argv=[str(script),'--help']\n"
            "runpy.run_path(str(script),run_name='__main__')\n"
        )
        return subprocess.run(
            [
                sys.executable, "-I", "-S", "-B", "-X",
                "pycache_prefix=NUL", "-c", code,
            ],
            cwd=script.parent,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_preimport_gate_rejects_custom_meta_finder_before_side_effect(self) -> None:
        marker = self.root / "meta-finder-executed"
        body = (
            "class Finder:\n"
            "    def find_spec(self,fullname,path=None,target=None):\n"
            "        if fullname in {'e57_image2d_evidence','e57_stage_guard','panorama_image2d_crosswalk'}:\n"
            f"            pathlib.Path({str(marker)!r}).write_text('executed')\n"
            "        return None\n"
            "sys.meta_path.insert(0,Finder())"
        )
        result = self._run_builder_code(body)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("meta path differs from the standard machinery", result.stderr)
        self.assertFalse(marker.exists())

    def test_preimport_gate_clears_custom_path_importer_cache(self) -> None:
        marker = self.root / "path-cache-finder-executed"
        body = (
            "class Finder:\n"
            "    def find_spec(self,fullname,target=None):\n"
            "        if fullname in {'e57_image2d_evidence','e57_stage_guard','panorama_image2d_crosswalk'}:\n"
            f"            pathlib.Path({str(marker)!r}).write_text('executed')\n"
            "        return None\n"
            "sys.path_importer_cache[str(script.parent)]=Finder()"
        )
        result = self._run_builder_code(body)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--verify-source-hashes", result.stdout)
        self.assertFalse(marker.exists())

    def test_import_gate_rejects_cache_subclass_without_calling_clear(self) -> None:
        marker = self.root / "cache-clear-executed"

        class Cache(dict):
            def clear(self) -> None:
                marker.write_text("executed", encoding="utf-8")

        with patch.object(builder.sys, "path_importer_cache", Cache()):
            with self.assertRaisesRegex(ValueError, "exact dictionary"):
                builder._verify_standard_import_machinery(reset_cache=True)
        self.assertFalse(marker.exists())

    def test_import_gate_rejects_spoofed_path_hook_before_call(self) -> None:
        marker = self.root / "path-hook-executed"
        real = builder.sys.path_hooks[1]

        class Hook:
            __code__ = real.__code__
            __closure__ = real.__closure__

            def __call__(self, _: str) -> object:
                marker.write_text("executed", encoding="utf-8")
                raise ImportError

        hooks = [builder.zipimport.zipimporter, Hook()]
        with patch.object(builder.sys, "path_hooks", hooks):
            with self.assertRaisesRegex(ValueError, "file-finder hook differs"):
                builder._verify_standard_import_machinery(reset_cache=False)
        self.assertFalse(marker.exists())

    def test_import_gate_rejects_spoofed_function_before_code_access(self) -> None:
        marker = self.root / "function-code-read"

        class Callable:
            @property
            def __code__(self) -> object:
                marker.write_text("executed", encoding="utf-8")
                return object()

        with self.assertRaisesRegex(ValueError, "path finder differs"):
            builder._verify_importlib_function(Callable(), "0" * 64, "path finder")
        self.assertFalse(marker.exists())

    def test_import_gate_rejects_mutated_path_finder_before_call(self) -> None:
        marker = self.root / "path-finder-executed"

        def poisoned(*_: object, **__: object) -> object:
            marker.write_text("executed", encoding="utf-8")
            return None

        with patch.object(builder.PathFinder, "find_spec", classmethod(poisoned)):
            with self.assertRaisesRegex(ValueError, "path finder differs"):
                builder._verify_standard_import_machinery(reset_cache=False)
        self.assertFalse(marker.exists())

    def test_import_gate_fingerprints_path_finder_constants(self) -> None:
        original = builder.PathFinder.__dict__["find_spec"].__func__
        constants = (*original.__code__.co_consts[:-1], 7)
        code = original.__code__.replace(co_consts=constants)
        changed = type(original)(
            code, original.__globals__, original.__name__,
            original.__defaults__, original.__closure__,
        )
        with patch.object(builder.PathFinder, "find_spec", classmethod(changed)):
            with self.assertRaisesRegex(ValueError, "path finder differs"):
                builder._verify_standard_import_machinery(reset_cache=False)

    def test_import_gate_rejects_mutated_builtin_import_before_call(self) -> None:
        marker = self.root / "builtin-import-executed"

        def poisoned(*_: object, **__: object) -> object:
            marker.write_text("executed", encoding="utf-8")
            return None

        with patch.object(builder.builtins, "__import__", poisoned):
            with self.assertRaisesRegex(ValueError, "import primitive differs"):
                builder._verify_standard_import_machinery(reset_cache=False)
        self.assertFalse(marker.exists())

    def test_runtime_cleanup_closes_seal_when_deactivation_raises(self) -> None:
        guard = MagicMock()
        seal = MagicMock()
        with patch.object(
            builder, "_deactivate_dependency_import_path",
            side_effect=RuntimeError("deactivate failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "deactivate failed"):
                builder._close_numeric_runtime(self.root, guard, seal)
        seal.close.assert_called_once()

    def test_existing_path_seal_reports_close_failure_and_retries(self) -> None:
        calls: list[int] = []

        def close_handle(handle: int) -> bool:
            calls.append(handle)
            return handle != 2 or calls.count(2) > 1

        seal = builder.ExistingPathWriteSeal(self.root, (1, 2, 3), close_handle)
        with self.assertRaisesRegex(OSError, "could not close dependency seal handle: 2"):
            seal.close()
        self.assertEqual(calls, [3, 2, 1])
        self.assertTrue(seal.active)
        seal.close()
        self.assertEqual(calls, [3, 2, 1, 2])
        self.assertFalse(seal.active)

    def test_backend_close_retries_a_pending_seal_handle(self) -> None:
        backend = object.__new__(OpenCvSiftBackend)
        backend._closed = False
        backend._dependency_site_root = self.root
        backend._dependency_import_guard = MagicMock(active=True)
        backend._dependency_path_seal = MagicMock(active=True)
        attempts = 0

        def close_seal() -> None:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise OSError("close failed")
            backend._dependency_path_seal.active = False

        def deactivate(*_: object) -> bool:
            backend._dependency_import_guard.active = False
            return False

        backend._dependency_path_seal.close.side_effect = close_seal
        deactivation = MagicMock(side_effect=deactivate)
        with patch.object(builder, "_deactivate_dependency_import_path", deactivation):
            with self.assertRaisesRegex(OSError, "close failed"):
                backend.close()
            self.assertFalse(backend._closed)
            backend.close()
        self.assertTrue(backend._closed)
        self.assertEqual(attempts, 2)
        deactivation.assert_called_once()

    def test_direct_worker_rejects_each_missing_boundary_flag(self) -> None:
        script = Path(builder.__file__).resolve()
        environment = os.environ.copy()
        environment.pop("PYTHONPATH", None)
        required = ["-I", "-S", "-B", "-X", "pycache_prefix=NUL"]
        variants = (
            required[1:],
            [required[0], *required[2:]],
            [*required[:2], *required[3:]],
            required[:3],
        )
        for flags in variants:
            with self.subTest(flags=flags):
                result = subprocess.run(
                    [sys.executable, *flags, str(script), "--help"],
                    cwd=self.root,
                    env=environment,
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("requires Python -I -S -B", result.stderr)

    def test_worker_rejects_non_exact_path_container_before_mutation(self) -> None:
        marker = self.root / "path-container-mutated"
        body = (
            "class Paths(list):\n"
            "    def __setitem__(self,key,value):\n"
            f"        pathlib.Path({str(marker)!r}).write_text('executed')\n"
            "        return super().__setitem__(key,value)\n"
            "sys.path=Paths(sys.path)"
        )
        result = self._run_builder_code(body)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exact Python import-state containers", result.stderr)
        self.assertFalse(marker.exists())

    @unittest.skipUnless(os.name == "nt", "Windows existing-path write seal")
    def test_existing_path_seal_is_truthful_about_child_creation(self) -> None:
        dependency_root = self.root / "site-packages"
        child = dependency_root / "package"
        child.mkdir(parents=True)
        existing = child / "module.py"
        existing.write_text("reviewed\n", encoding="utf-8")
        seal = builder._seal_existing_dependency_paths(dependency_root)
        try:
            with self.assertRaises(OSError):
                existing.write_text("changed\n", encoding="utf-8")
            created = child / "new.py"
            created.write_text("new\n", encoding="utf-8")
            with self.assertRaises(OSError):
                existing.rename(child / "renamed.py")
        finally:
            seal.close()
        existing.write_text("changed\n", encoding="utf-8")
        existing.rename(child / "renamed.py")

    def test_dependency_import_guard_rejects_a_file_added_after_inventory(self) -> None:
        site_root = self.root / "site-packages"
        package = site_root / "allowed"
        package.mkdir(parents=True)
        allowed = package / "__init__.py"
        allowed.write_text("VALUE = 1\n", encoding="utf-8")
        guard = builder.VerifiedPathFinder(site_root, (allowed.resolve(strict=True),))
        guard.active = True
        rogue = site_root / "rogue.py"
        rogue.write_text("raise RuntimeError('must not execute')\n", encoding="utf-8")
        with self.assertRaisesRegex(ImportError, "not allowlisted"):
            guard.find_spec("rogue", [str(site_root)])
        foreign = self.root / "foreign"
        foreign.mkdir()
        (foreign / "rogue.py").write_text("raise RuntimeError\n", encoding="utf-8")
        with self.assertRaisesRegex(ImportError, "namespace escaped"):
            guard.find_spec("allowed.rogue", [str(foreign)])


class BuildPanoramaImage2DCrosswalkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        global np
        cls.wheel_root = Path(
            os.environ.get(
                "CROSSWALK_WHEEL_ROOT", r"D:\venviewer-tools\t560-wheelhouse-v1"
            )
        )
        cls.backend = OpenCvSiftBackend(cls.wheel_root)
        np = cls.backend.np

    @classmethod
    def tearDownClass(cls) -> None:
        cls.backend.close()

    def setUp(self) -> None:
        temporary_root = os.environ.get("E57_EVIDENCE_TEST_TMP")
        self.temporary = tempfile.TemporaryDirectory(dir=temporary_root)
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _synthetic_scan_pair(self, reflected: bool = False, incoherent: bool = False):
        intrinsics = Intrinsics(100, 100, 1.0, 0.02, 0.02, 50.0, 50.0)
        points = np.asarray([(x, y) for x in (25.0, 40.0, 60.0, 75.0) for y in (35.0, 65.0)], np.float32)
        descriptors = np.random.default_rng(8844).normal(size=(48, 128)).astype(np.float32)
        faces, pano_points = [], []
        for index in range(6):
            segment = descriptors[index * 8:(index + 1) * 8]
            feature = FeatureArtifact(identity(f"face-{index}"), 100, 100, points.copy(), segment.copy())
            face = self._face(feature, intrinsics, index)
            faces.append(face)
            rays = self.backend._cubemap_rays(points, face)
            if reflected:
                rays[:, 1] *= -1
            angle = (index * 0.23) if incoherent else 0.31
            rotation = self._z_rotation(angle)
            pano_points.append(self._rays_to_panorama(rays @ rotation.T, 800, 400))
        artifact = FeatureArtifact(identity("synthetic-panorama"), 800, 400, np.concatenate(pano_points), descriptors.copy())
        return PanoramaFeature(artifact.identity_sha256, artifact), ScanFeature("opaque-scan-guid", tuple(faces))

    def _z_rotation(self, angle: float):
        cosine, sine = np.cos(angle), np.sin(angle)
        return np.asarray([[cosine, -sine, 0.0], [sine, cosine, 0.0], [0.0, 0.0, 1.0]])

    def _rays_to_panorama(self, rays, width: int, height: int):
        longitude = np.mod(np.arctan2(rays[:, 1], rays[:, 0]), 2 * np.pi)
        latitude = np.arcsin(np.clip(rays[:, 2], -1.0, 1.0))
        return np.column_stack([longitude / (2 * np.pi) * width, (np.pi / 2 - latitude) / np.pi * height]).astype(np.float32)

    def test_exact_dependency_lock_and_preserved_wheels_verify(self) -> None:
        wheel_root = Path(os.environ.get("CROSSWALK_WHEEL_ROOT", r"D:\venviewer-tools\t560-wheelhouse-v1"))
        if not wheel_root.is_dir():
            self.skipTest("preserved D: wheel root is unavailable")
        site_root = self.backend.distribution_roots["numpy"]
        if any(path for name in ("numpy", "cv2") for path in site_root.joinpath(name).rglob("*.pyc")):
            self.skipTest("active dependency tree contains forbidden bytecode; use the no-compile v2 venv")
        lock, attestation = verify_dependency_lock(
            builder.LOCK_PATH, wheel_root, self.backend.dependency_versions,
            self.backend.runtime_file_paths, self.backend.runtime_controls,
            self.backend.distribution_roots,
        )
        self.assertEqual(lock["runtime"]["pythonVersion"], "3.12.12")
        self.assertEqual(len(attestation.lock_sha256), 64)
        self.assertEqual(self.backend.cv2.getNumThreads(), 1)
        self.assertFalse(self.backend.cv2.ocl.useOpenCL())
        self.assertTrue(self.backend.runtime_controls["pythonPathEnvironmentAbsent"])
        self.assertTrue(self.backend.runtime_controls["pythonIsolated"])
        self.assertTrue(self.backend.runtime_controls["pythonNoSite"])
        self.assertTrue(self.backend.runtime_controls["dependencyImportAllowlistEnforced"])

    def test_sift_features_repeat_exactly_for_the_same_bytes(self) -> None:
        generator = np.random.default_rng(90210)
        image = generator.integers(0, 256, size=(256, 512), dtype=np.uint8)
        content = jpeg_bytes(self.backend, image)
        digest = hashlib.sha256(content).hexdigest()
        first = self.backend.extract_panorama(digest, content)
        second = self.backend.extract_panorama(digest, content)
        self.assertTrue(np.array_equal(first.points, second.points))
        self.assertTrue(np.array_equal(first.descriptors, second.descriptors))
        self.assertGreater(len(first.descriptors), 100)

    def _face(self, feature: FeatureArtifact, intrinsics: Intrinsics, index: int = 0) -> FaceFeature:
        return FaceFeature(feature.identity_sha256, index, intrinsics, feature)

    def test_native_rays_use_exact_recorded_intrinsics(self) -> None:
        points = np.asarray([[50.0, 50.0], [100.0, 50.0]], dtype=np.float32)
        feature = FeatureArtifact(identity("face"), 100, 100, points, np.empty((2, 128), np.float32))
        intrinsics = Intrinsics(100, 100, 0.5, 0.01, 0.01, 50.0, 50.0)
        rays = self.backend._pinhole_rays(points, self._face(feature, intrinsics))
        self.assertTrue(np.allclose(rays[0], [1.0, 0.0, 0.0]))
        self.assertTrue(np.allclose(rays[1], np.asarray([1.0, 1.0, 0.0]) / np.sqrt(2)))

    def test_equirect_seam_pole_and_chirality_are_diagnostic_only(self) -> None:
        feature = FeatureArtifact(identity("pano"), 100, 50, (), ())
        points = np.asarray([[0.0, 25.0], [100.0, 25.0], [0.0, 0.0]], dtype=np.float64)
        rays = self.backend._panorama_rays(points, feature)
        self.assertTrue(np.allclose(rays[0], rays[1], atol=1e-12))
        self.assertTrue(np.allclose(rays[2], [0.0, 0.0, 1.0], atol=1e-12))
        source = np.random.default_rng(4).normal(size=(24, 3))
        source /= np.linalg.norm(source, axis=1, keepdims=True)
        target = source.copy()
        target[:, 1] *= -1
        fit = self.backend._rotation_ransac(source, target, 99)
        self.assertIsNotNone(fit)
        self.assertTrue(fit.global_reflection_applied)
        self.assertEqual(len(fit.errors), 24)
        self.assertLess(max(fit.errors), 0.001)

    def test_real_backend_uses_one_coherent_cubemap_model_and_is_reorder_stable(self) -> None:
        panorama, scan = self._synthetic_scan_pair()
        first = self.backend.verify_candidate(panorama, scan)
        second = self.backend.verify_candidate(panorama, ScanFeature(scan.data3d_guid, tuple(reversed(scan.faces))))
        self.assertEqual(first, second)
        self.assertTrue(first.cube_coherent)
        self.assertFalse(first.global_reflection_applied)
        self.assertEqual(first.supported_faces, 6)
        self.assertEqual(first.spherical_inliers, 48)

    def test_real_backend_global_mirror_is_explicit_and_incoherent_faces_fail_closed(self) -> None:
        panorama, scan = self._synthetic_scan_pair(reflected=True)
        mirrored = self.backend.verify_candidate(panorama, scan)
        self.assertTrue(mirrored.cube_coherent)
        self.assertTrue(mirrored.global_reflection_applied)
        incoherent_panorama, incoherent_scan = self._synthetic_scan_pair(incoherent=True)
        incoherent = self.backend.verify_candidate(incoherent_panorama, incoherent_scan)
        self.assertFalse(incoherent.cube_coherent)
        self.assertLess(incoherent.supported_faces, 3)

    def test_real_backend_retrieval_repeats_under_scan_and_face_permutation(self) -> None:
        panorama, scan = self._synthetic_scan_pair()
        other = ScanFeature("renamed-display-free-guid", tuple(reversed(scan.faces)))
        first = self.backend.complete_retrieval([panorama], [scan, other])
        second = self.backend.complete_retrieval([panorama], [other, ScanFeature(scan.data3d_guid, tuple(reversed(scan.faces)))])
        self.assertEqual(first, second)
        self.assertEqual({item.data3d_guid for item in first}, {scan.data3d_guid, other.data3d_guid})

    def test_textureless_inputs_emit_complete_zero_retrieval(self) -> None:
        content = jpeg_bytes(self.backend, np.zeros((128, 256), dtype=np.uint8))
        pano_digest = hashlib.sha256(content).hexdigest()
        pano_feature = self.backend.extract_panorama(pano_digest, content)
        face_digest = identity("blank-face")
        intrinsics = Intrinsics(256, 128, 0.5, 1 / 256, 1 / 256, 128.0, 64.0)
        face_feature = self.backend.extract_face(face_digest, intrinsics, content)
        scores = self.backend.complete_retrieval([PanoramaFeature(pano_digest, pano_feature)], [ScanFeature("guid", (self._face(face_feature, intrinsics),))])
        self.assertEqual(scores, [RetrievalScore(pano_digest, "guid", 0, 0)])

    def test_candidate_verifier_is_identity_bound_not_ordinal_bound(self) -> None:
        empty = FeatureArtifact(identity("empty"), 10, 5, np.empty((0, 2), np.float32), np.empty((0, 128), np.float32))
        pano = PanoramaFeature(identity("panorama-bytes"), empty)
        scan = ScanFeature("opaque-guid-not-an-index", ())
        result = self.backend.verify_candidate(pano, scan)
        self.assertEqual(result, CandidateVerification(
            pano.panorama_sha256, scan.data3d_guid, 0, 0, 0, None, None,
            None, False, tuple((index, 0) for index in range(6)),
        ))

    def _derived(self) -> DerivedCrosswalk:
        bindings = SourceBindings(*(["a" * 64, 1, "b" * 64, "c" * 64, 1, "d" * 64, 1, "e" * 64, "f" * 64]))
        matrix = {"authority": "none", "schemaVersion": "fixture"}
        files = tuple(GeneratorFileBinding(path, str(index + 1) * 64, index + 1) for index, path in enumerate(builder.GENERATOR_PATHS))
        generator = GeneratorBinding("a" * 40, files)
        packages = (
            DependencyPackageAttestation("numpy", 1, "b" * 64, "c" * 64),
            DependencyPackageAttestation("opencv-python-headless", 1, "d" * 64, "e" * 64),
        )
        dependency = DependencyAttestation("same_host_same_binary_only", "f" * 64, packages, "1" * 64)
        return DerivedCrosswalk(matrix, [], [], [], bindings, FROZEN_CONFIGURATION, generator, dependency)

    def test_check_recomputes_before_verifying_the_existing_pack(self) -> None:
        derived = self._derived()
        events: list[str] = []
        with (
            patch.object(builder, "capture_generator_binding", return_value=derived.generator),
            patch.object(builder, "verify_frozen_basis_report", return_value="report"),
            patch.object(builder, "_dependency_attestation", return_value=derived.dependency),
            patch.object(builder, "_verify_run_provenance", side_effect=lambda *args: events.append("provenance")) as provenance,
            patch.object(builder, "assert_disjoint_output", return_value=Path("D:/output")),
            patch.object(builder, "_require_safe_output"),
            patch.object(builder, "capture_input_custody", return_value="custody"),
            patch.object(builder, "verify_input_custody") as custody_check,
            patch.object(builder, "verify_final_input_custody", side_effect=lambda *args: events.append("custody")) as final_custody_check,
            patch.object(builder, "_load_sources", return_value=([], [])) as load,
            patch.object(builder, "_derive_crosswalk", return_value=derived) as derive,
            patch.object(builder, "_crosswalk_for_matrix", return_value={"authority": "none"}),
            patch.object(builder, "verify_crosswalk_pack", side_effect=lambda *args: events.append("verify")) as verify,
        ):
            result = run_check(
                Path("D:/panos"), Path("D:/manifest"), Path("D:/images"),
                Path("D:/output"), Path("D:/wheels"), "a" * 40,
                Path("D:/basis/report.json"), backend=self.backend,
            )
        self.assertIs(result, derived)
        load.assert_called_once()
        derive.assert_called_once()
        verify.assert_called_once()
        custody_check.assert_called_once_with("custody")
        self.assertEqual(final_custody_check.call_count, 2)
        final_custody_check.assert_called_with("custody", [], [])
        self.assertEqual(provenance.call_count, 2)
        self.assertEqual(events, ["custody", "provenance", "verify", "custody", "provenance"])

    def test_build_rechecks_provenance_around_publication(self) -> None:
        derived = self._derived()
        events: list[str] = []
        with (
            patch.object(builder, "capture_generator_binding", return_value=derived.generator),
            patch.object(builder, "verify_frozen_basis_report", return_value="report"),
            patch.object(builder, "_dependency_attestation", return_value=derived.dependency),
            patch.object(builder, "_verify_run_provenance", side_effect=lambda *args: events.append("provenance")) as provenance,
            patch.object(builder, "assert_disjoint_output", return_value=Path("D:/output")),
            patch.object(builder, "_require_safe_output"),
            patch.object(builder, "capture_input_custody", return_value="custody"),
            patch.object(builder, "verify_input_custody"),
            patch.object(builder, "verify_final_input_custody", side_effect=lambda *args: events.append("custody")),
            patch.object(builder, "_load_sources", return_value=([], [])),
            patch.object(builder, "_derive_crosswalk", return_value=derived),
            patch.object(builder, "publish_crosswalk_pack", side_effect=lambda *args: events.append("publish")) as publish,
        ):
            result = builder.run_build(
                Path("D:/panos"), Path("D:/manifest"), Path("D:/images"),
                Path("D:/output"), Path("D:/wheels"), "a" * 40,
                Path("D:/basis/report.json"), backend=self.backend,
            )
        self.assertIs(result, derived)
        publish.assert_called_once()
        self.assertEqual(provenance.call_count, 2)
        self.assertEqual(events, ["custody", "provenance", "publish", "custody", "provenance"])

    def test_real_run_provenance_accepts_the_active_guarded_backend(self) -> None:
        generator = self._derived().generator
        report_snapshot = object()
        dependency = self.backend.initial_dependency_attestation
        with (
            patch.object(builder, "capture_generator_binding", return_value=generator),
            patch.object(builder, "verify_frozen_basis_report", return_value=report_snapshot),
            patch.object(builder, "verify_dependency_lock", return_value=({}, dependency)),
        ):
            builder._verify_run_provenance(
                self.backend,
                self.wheel_root,
                builder.REPO_ROOT,
                "a" * 40,
                Path("D:/basis/report.json"),
                generator,
                dependency,
                report_snapshot,
            )

    def test_internally_owned_backend_closes_when_prepare_fails(self) -> None:
        arguments = (
            Path("D:/panos"), Path("D:/manifest"), Path("D:/images"),
            Path("D:/output"), Path("D:/wheels"), "a" * 40,
            Path("D:/basis/report.json"),
        )
        for operation in (builder.run_build, builder.run_check):
            with self.subTest(operation=operation.__name__):
                manager = MagicMock()
                manager.__enter__.return_value = self.backend
                manager.__exit__.return_value = False
                with (
                    patch.object(builder, "OpenCvSiftBackend", return_value=manager),
                    patch.object(builder, "_prepare_run", side_effect=RuntimeError("stop")),
                ):
                    with self.assertRaisesRegex(RuntimeError, "stop"):
                        operation(*arguments)
                manager.__exit__.assert_called_once()

    @unittest.skipUnless(os.name == "nt", "Windows output policy")
    def test_output_policy_rejects_system_and_extended_paths(self) -> None:
        with self.assertRaisesRegex(ValueError, "system C"):
            builder._require_safe_output(Path("C:/unsafe"))
        with self.assertRaisesRegex(ValueError, "ordinary local drive"):
            builder._require_safe_output(Path(r"\\?\D:\unsafe"))

    def test_protected_input_set_includes_dependencies_basis_and_all_generators(self) -> None:
        repo = Path("D:/repo")
        basis = Path("F:/basis/report.json")
        protected = builder._protected_inputs(
            Path("D:/panos"), Path("D:/manifest/source.json"), Path("D:/image2d"),
            Path("D:/wheelhouse"), basis, repo,
        )
        self.assertIn(Path("D:/wheelhouse"), protected)
        self.assertIn(basis, protected)
        self.assertIn(basis.parent, protected)
        for relative in (*builder.GENERATOR_PATHS, builder.DEPENDENCY_LOCK_RELATIVE_PATH):
            self.assertIn(repo / Path(relative), protected)

    def test_backend_rejects_bytecode_writes_and_unbound_startup_hooks(self) -> None:
        with patch.object(builder.sys, "dont_write_bytecode", False):
            with self.assertRaisesRegex(ValueError, "Python -B"):
                OpenCvSiftBackend(self.wheel_root)

    def test_numeric_environment_rejects_preloaded_submodules_before_mutation(self) -> None:
        original = dict(FROZEN_CONFIGURATION.thread_environment)
        sentinel = object()
        for name in ("numpy.core._multiarray_umath", "cv2.foo"):
            with self.subTest(module=name):
                with (
                    patch.dict(builder.sys.modules, {name: sentinel}, clear=False),
                    patch.dict(builder.os.environ, {}, clear=True),
                ):
                    with self.assertRaisesRegex(ValueError, "imported before"):
                        builder._activate_numeric_environment(FROZEN_CONFIGURATION)
                    self.assertTrue(all(key not in builder.os.environ for key in original))
        with patch.object(builder, "_startup_hook_files", return_value=["D:/evil.pth"]):
            with self.assertRaisesRegex(ValueError, "startup hook"):
                OpenCvSiftBackend(self.wheel_root)

    def test_backend_rejects_non_frozen_configuration_and_reflection_axis(self) -> None:
        changed = replace(FROZEN_CONFIGURATION, determinism_scope="unreviewed")
        with self.assertRaisesRegex(ValueError, "frozen reviewed configuration"):
            OpenCvSiftBackend(self.wheel_root, changed)
        verification = replace(
            FROZEN_CONFIGURATION.verification,
            global_reflection_axis="scanner_x",
        )
        original = self.backend.configuration
        self.backend.configuration = replace(original, verification=verification)
        try:
            rays = np.eye(3, dtype=np.float64)
            with self.assertRaisesRegex(ValueError, "global-reflection axis"):
                self.backend._fit_global_chirality(rays, rays, 1, True)
        finally:
            self.backend.configuration = original

    def test_startup_gate_rejects_path_environment_and_foreign_root(self) -> None:
        for value in ("", "D:/foreign"):
            with self.subTest(pythonpath=value):
                with patch.dict(builder.os.environ, {"PYTHONPATH": value}):
                    with self.assertRaisesRegex(ValueError, "forbids PYTHONPATH"):
                        builder._verify_startup_environment()
        foreign = self.root / "foreign"
        foreign.mkdir()
        with patch.object(builder.sys, "path", [str(foreign), *builder.sys.path]):
            with self.assertRaisesRegex(ValueError, "foreign Python import roots"):
                builder._verify_import_path(self.backend._dependency_site_root)

    def test_local_module_origins_are_bound_and_rechecked(self) -> None:
        builder._verify_local_module_origins(builder.REPO_ROOT)
        with patch.dict(builder.sys.modules, {"e57_stage_guard": object()}):
            with self.assertRaisesRegex(ValueError, "binding changed: e57_stage_guard"):
                builder._verify_local_module_origins(builder.REPO_ROOT)
        module = builder.sys.modules["panorama_image2d_crosswalk"]
        spoof = self.root / "spoof.py"
        spoof.write_text("# not reviewed\n", encoding="utf-8")
        with patch.object(module, "__file__", str(spoof)):
            with self.assertRaisesRegex(ValueError, "origin drifted"):
                builder._verify_local_module_origins(builder.REPO_ROOT)
        with patch.object(module, "__spec__", None):
            with self.assertRaisesRegex(ValueError, "spec origin drifted"):
                builder._verify_local_module_origins(builder.REPO_ROOT)

    def test_local_import_specs_reject_all_bytecode_cache_forms(self) -> None:
        source = Path(builder.__file__).resolve().parent
        scripts = self.root / "scripts"
        scripts.mkdir()
        for name in builder._LOCAL_GENERATOR_MODULE_NAMES:
            shutil.copy2(source / f"{name}.py", scripts / f"{name}.py")
        cached = scripts / "__pycache__" / (
            f"e57_stage_guard.{sys.implementation.cache_tag}.pyc"
        )
        cached.parent.mkdir()
        cached.write_bytes(b"not executable")
        with self.assertRaisesRegex(ValueError, "bytecode caches are forbidden"):
            builder._verify_local_import_specs(scripts)
        cached.unlink()
        (scripts / "e57_stage_guard.pyc").write_bytes(b"not executable")
        with self.assertRaisesRegex(ValueError, "bytecode caches are forbidden"):
            builder._verify_local_import_specs(scripts)

    def test_numeric_preflight_rejects_decoys_without_executing_them(self) -> None:
        plan = builder.DependencyImportPlan(
            dict(self.backend.dependency_versions),
            dict(self.backend.distribution_roots),
            {name: dict(values) for name, values in self.backend.runtime_file_paths.items()},
            dict(self.backend.runtime_controls),
            dict(self.backend.package_origin_paths),
            tuple(self.backend._dependency_import_guard.site_files),
            self.backend.initial_dependency_attestation,
        )
        for module_name in ("cv2", "numpy"):
            with self.subTest(module=module_name):
                marker = self.root / f"{module_name}-executed"
                decoy = self.root / f"{module_name}-decoy"
                package = decoy / module_name
                package.mkdir(parents=True)
                (package / "__init__.py").write_text(
                    "from pathlib import Path\n"
                    f"Path({str(marker)!r}).write_text('executed')\n",
                    encoding="utf-8",
                )
                import_path = list(self.backend._numeric_import_path)
                import_path.insert(1, str(decoy))
                with self.assertRaisesRegex(ValueError, "import origin is not bound"):
                    builder._numeric_import_origins(plan, tuple(import_path))
                self.assertFalse(marker.exists())

    def test_preimport_gate_rejects_decoy_before_local_module_execution(self) -> None:
        marker = self.root / "decoy-executed"
        decoy = self.root / "decoy"
        decoy.mkdir()
        (decoy / "e57_image2d_evidence.py").write_text(
            f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')\n",
            encoding="utf-8",
        )
        script = Path(builder.__file__).resolve()
        code = (
            "import runpy,sys;"
            f"sys.path.insert(0,{str(decoy)!r});"
            f"runpy.run_path({str(script)!r},run_name='__main__')"
        )
        environment = os.environ.copy()
        environment.pop("PYTHONPATH", None)
        result = subprocess.run(
            [
                sys.executable, "-I", "-S", "-B", "-X",
                "pycache_prefix=NUL", "-c", code,
            ],
            cwd=builder._PREIMPORT_TRUSTED_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("foreign Python import roots", result.stderr)
        self.assertFalse(marker.exists())

    def test_direct_script_help_passes_the_preimport_gate(self) -> None:
        environment = os.environ.copy()
        environment.pop("PYTHONPATH", None)
        result = subprocess.run(
            [
                sys.executable, "-I", "-S", "-B", "-X",
                "pycache_prefix=NUL", str(Path(builder.__file__).resolve()), "--help",
            ],
            cwd=builder._PREIMPORT_TRUSTED_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--verify-source-hashes", result.stdout)

    def test_cli_requires_explicit_source_hash_acknowledgement(self) -> None:
        stderr = StringIO()
        with redirect_stderr(stderr):
            with self.assertRaises(SystemExit) as raised:
                main([
                    "--panorama-root", "D:/p",
                    "--panorama-manifest", "D:/m",
                    "--image2d-evidence-root", "D:/e",
                    "--out", "D:/o",
                    "--dependency-wheel-root", "D:/w",
                    "--reviewed-git-sha", "a" * 40,
                    "--cube-basis-report", "D:/basis.json",
                ])
        self.assertEqual(raised.exception.code, 2)
        self.assertIn("--verify-source-hashes is mandatory", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
