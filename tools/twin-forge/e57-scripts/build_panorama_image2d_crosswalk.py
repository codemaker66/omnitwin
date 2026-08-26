"""Build or strictly recompute the authority-none panorama/Image2D crosswalk."""

from __future__ import annotations

import sys

if not (
    sys.flags.isolated == 1
    and sys.flags.no_site == 1
    and sys.flags.no_user_site == 1
    and sys.flags.ignore_environment == 1
    and sys.flags.safe_path
    and sys.dont_write_bytecode
    and sys.pycache_prefix == "NUL"
):
    raise RuntimeError(
        "the matcher requires Python -I -S -B -X pycache_prefix=NUL"
    )
if not (
    type(sys.path) is list
    and type(sys.modules) is dict
    and type(sys.meta_path) is list
    and type(sys.path_hooks) is list
    and type(sys.path_importer_cache) is dict
):
    raise RuntimeError("the matcher requires exact Python import-state containers")

import argparse
import builtins
from contextlib import nullcontext
from dataclasses import asdict, dataclass
import hashlib
from importlib.machinery import (
    BYTECODE_SUFFIXES,
    EXTENSION_SUFFIXES,
    SOURCE_SUFFIXES,
    BuiltinImporter,
    ExtensionFileLoader,
    FileFinder,
    FrozenImporter,
    PathFinder,
    SourceFileLoader,
    SourcelessFileLoader,
)
from importlib.util import module_from_spec, spec_from_file_location
import math
import json
import os
from pathlib import Path
from types import BuiltinFunctionType, CodeType, FunctionType
from typing import Any, Sequence
import zipimport


_LOCAL_GENERATOR_MODULE_NAMES = (
    "panorama_image2d_crosswalk",
    "build_panorama_image2d_crosswalk",
    "e57_image2d_evidence",
    "e57_stage_guard",
)
_LOCAL_DEPENDENCY_MODULE_NAMES = (
    "e57_image2d_evidence",
    "e57_stage_guard",
    "panorama_image2d_crosswalk",
)
_BUILDER_MODULE_NAME = "build_panorama_image2d_crosswalk"
_CUSTOM_STARTUP_MODULE_NAMES = ("sitecustomize", "usercustomize")
_PATH_FINDER_CODE_SHA256 = "b6f1b79c7f1cdce9042cd5cc070bab78da2381efe20fe27053862f0ca7bd4962"
_FILE_FINDER_FACTORY_CODE_SHA256 = "ce3ae679508afa57800c411d1f982a5feff7a3da8d8e75d832b778075574bbc5"
_FILE_FINDER_HOOK_CODE_SHA256 = "da680af0b5536e9cd1fe4bc5416e04a8dd104d0517fab51839a5b8838f2cc30d"


def _trusted_local_import_root() -> Path:
    return Path(__file__).resolve(strict=True).parent


def _python_path_environment_absent() -> bool:
    return "PYTHONPATH" not in os.environ


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _base_import_roots() -> set[Path]:
    return {
        Path(sys.base_prefix).resolve(strict=True),
        Path(sys.prefix).resolve(strict=True),
    }


def _sanitize_base_import_path() -> None:
    local = _trusted_local_import_root()
    roots = _base_import_roots()
    trusted: list[str] = []
    for raw in sys.path:
        if not isinstance(raw, str) or not raw:
            raise ValueError("Python import paths must be non-empty strings")
        candidate = Path(raw)
        if not candidate.exists():
            continue
        resolved = candidate.resolve(strict=True)
        if resolved == local:
            continue
        if not any(_is_within(resolved, root) for root in roots):
            raise ValueError("foreign Python import roots are forbidden")
        value = str(resolved)
        if value in trusted:
            raise ValueError("duplicate Python import roots are forbidden")
        trusted.append(value)
    sys.path[:] = trusted


def _verify_import_path(dependency_root: Path | None = None) -> None:
    roots = _base_import_roots()
    dependency = None if dependency_root is None else dependency_root.resolve(strict=True)
    seen: set[Path] = set()
    for raw in sys.path:
        if not isinstance(raw, str) or not raw:
            raise ValueError("Python import paths must be non-empty strings")
        resolved = Path(raw).resolve(strict=True)
        if resolved in seen:
            raise ValueError("duplicate Python import roots are forbidden")
        seen.add(resolved)
        if resolved != dependency and not any(_is_within(resolved, root) for root in roots):
            raise ValueError("foreign Python import roots are forbidden")


def _frozen_importlib_globals(value: Any) -> bool:
    module = sys.modules.get("_frozen_importlib_external")
    return module is not None and getattr(value, "__globals__", None) is vars(module)


def _code_constant_material(value: Any) -> Any:
    if type(value) is CodeType:
        return ["code", _code_identity_material(value)]
    if type(value) is bytes:
        return ["bytes", value.hex()]
    if type(value) is tuple:
        return ["tuple", [_code_constant_material(item) for item in value]]
    if type(value) is frozenset:
        items = [_code_constant_material(item) for item in value]
        items.sort(key=lambda item: json.dumps(item, separators=(",", ":")))
        return ["frozenset", items]
    if value is None or type(value) in (bool, int, str):
        return [type(value).__name__, value]
    if type(value) is float:
        return ["float", value.hex()]
    raise ValueError(f"unsupported standard-code constant: {type(value).__name__}")


def _code_identity_material(code: CodeType) -> list[Any]:
    return [
        code.co_argcount, code.co_posonlyargcount, code.co_kwonlyargcount,
        code.co_nlocals, code.co_stacksize, code.co_flags, code.co_code.hex(),
        [_code_constant_material(value) for value in code.co_consts],
        list(code.co_names), list(code.co_varnames), list(code.co_freevars),
        list(code.co_cellvars), code.co_exceptiontable.hex(),
    ]


def _code_identity_sha256(code: CodeType) -> str:
    material = json.dumps(
        _code_identity_material(code), ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _verify_importlib_function(value: Any, digest: str, label: str) -> None:
    if type(value) is not FunctionType:
        raise ValueError(f"Python {label} differs from the pinned standard machinery")
    code = value.__code__
    if type(code) is not CodeType or _code_identity_sha256(code) != digest:
        raise ValueError(f"Python {label} differs from the pinned standard machinery")
    if not _frozen_importlib_globals(value):
        raise ValueError(f"Python {label} differs from the pinned standard machinery")


def _verify_import_primitives() -> None:
    importer = builtins.__import__
    if (
        type(importer) is not BuiltinFunctionType
        or importer.__self__ is not builtins
        or importer.__name__ != "__import__"
    ):
        raise ValueError("Python import primitive differs from the standard machinery")
    finder = PathFinder.__dict__.get("find_spec")
    factory = FileFinder.__dict__.get("path_hook")
    if type(finder) is not classmethod or type(factory) is not classmethod:
        raise ValueError("Python finder descriptors differ from the standard machinery")
    _verify_importlib_function(finder.__func__, _PATH_FINDER_CODE_SHA256, "path finder")
    _verify_importlib_function(
        factory.__func__, _FILE_FINDER_FACTORY_CODE_SHA256, "file-finder factory"
    )


def _verify_standard_path_hooks() -> None:
    if (
        type(sys.path_hooks) is not list
        or len(sys.path_hooks) != 2
        or sys.path_hooks[0] is not zipimport.zipimporter
    ):
        raise ValueError("Python path hooks differ from the standard machinery")
    hook = sys.path_hooks[1]
    if type(hook) is not FunctionType:
        raise ValueError("Python file-finder hook differs from the standard machinery")
    expected_code = FileFinder.path_hook().__code__
    closure = hook.__closure__
    if (
        hook.__code__ is not expected_code
        or _code_identity_sha256(hook.__code__) != _FILE_FINDER_HOOK_CODE_SHA256
        or not _frozen_importlib_globals(hook)
        or closure is None
    ):
        raise ValueError("Python file-finder hook differs from the standard machinery")
    values = tuple(cell.cell_contents for cell in closure)
    expected = (
        FileFinder,
        (
            (ExtensionFileLoader, list(EXTENSION_SUFFIXES)),
            (SourceFileLoader, list(SOURCE_SUFFIXES)),
            (SourcelessFileLoader, list(BYTECODE_SUFFIXES)),
        ),
    )
    if values != expected:
        raise ValueError("Python file-finder loader details drifted")


def _verify_standard_import_machinery(reset_cache: bool) -> None:
    if type(sys.meta_path) is not list or tuple(sys.meta_path) != (
        BuiltinImporter, FrozenImporter, PathFinder,
    ):
        raise ValueError("Python meta path differs from the standard machinery")
    _verify_import_primitives()
    _verify_standard_path_hooks()
    if len(sys._current_frames()) != 1:
        raise ValueError("dependency binding requires a single Python thread")
    if type(sys.path_importer_cache) is not dict:
        raise ValueError("Python path importer cache must be an exact dictionary")
    if reset_cache:
        sys.path_importer_cache.clear()
        if sys.path_importer_cache:
            raise ValueError("Python path importer cache did not clear")


def _startup_hook_files() -> list[str]:
    found: set[str] = set()
    for raw in sys.path:
        if not isinstance(raw, str):
            found.add("<non-string-sys.path-entry>")
            continue
        root = Path(raw or os.getcwd())
        if not root.is_dir():
            continue
        found.update(str(path.resolve()) for path in root.glob("*.pth") if path.is_file())
        found.update(
            str(root / f"{name}{suffix}")
            for name in _CUSTOM_STARTUP_MODULE_NAMES
            for suffix in (".py", ".pyc")
            if (root / f"{name}{suffix}").is_file()
        )
        for cache in root.glob("__pycache__"):
            found.update(
                str(path.resolve())
                for name in _CUSTOM_STARTUP_MODULE_NAMES
                for path in cache.glob(f"{name}*.pyc")
            )
    return sorted(found)


def _verify_local_import_specs(root: Path) -> None:
    for name in _LOCAL_GENERATOR_MODULE_NAMES:
        expected = (root / f"{name}.py").resolve(strict=True)
        if expected.parent != root:
            raise ValueError("local generator source escapes the trusted import root")
        spec = spec_from_file_location(name, expected)
        origin = None if spec is None else spec.origin
        loader = None if spec is None else spec.loader
        loader_path = None if loader is None else getattr(loader, "path", None)
        if (
            not isinstance(origin, str)
            or Path(origin).resolve(strict=True) != expected
            or type(loader) is not SourceFileLoader
            or not isinstance(loader_path, str)
            or Path(loader_path).resolve(strict=True) != expected
            or spec.submodule_search_locations is not None
        ):
            raise ValueError("local generator import spec does not bind the reviewed source")
        cached = None if spec is None else getattr(spec, "cached", None)
        cache_files = list((root / "__pycache__").glob(f"{name}*.pyc"))
        if (
            (isinstance(cached, str) and Path(cached).exists())
            or (root / f"{name}.pyc").exists()
            or cache_files
        ):
            raise ValueError("local generator bytecode caches are forbidden")


def _load_reviewed_local_modules(root: Path) -> None:
    loaded: list[str] = []
    try:
        for name in _LOCAL_DEPENDENCY_MODULE_NAMES:
            path = (root / f"{name}.py").resolve(strict=True)
            spec = spec_from_file_location(name, path)
            if spec is None or type(spec.loader) is not SourceFileLoader:
                raise ValueError("reviewed local source loader is unavailable")
            module = module_from_spec(spec)
            sys.modules[name] = module
            loaded.append(name)
            spec.loader.exec_module(module)
    except BaseException:
        for name in reversed(loaded):
            sys.modules.pop(name, None)
        raise


def _verify_preimport_startup_environment() -> Path:
    if not sys.dont_write_bytecode:
        raise ValueError("the matcher must run under Python -B with bytecode writes disabled")
    if not _python_path_environment_absent():
        raise ValueError("the matcher forbids PYTHONPATH, including an empty value")
    if "site" in sys.modules:
        raise ValueError("the matcher forbids Python site initialization")
    _sanitize_base_import_path()
    _verify_import_path()
    _verify_standard_import_machinery(reset_cache=True)
    if _startup_hook_files() or any(
        name in sys.modules for name in _CUSTOM_STARTUP_MODULE_NAMES
    ):
        raise ValueError("unbound Python startup hook files or modules are forbidden")
    current = sys.modules.get(__name__)
    preloaded = [
        name for name in _LOCAL_GENERATOR_MODULE_NAMES
        if name in sys.modules
        and not (name == _BUILDER_MODULE_NAME and sys.modules[name] is current)
    ]
    if preloaded:
        raise ValueError("local generator modules were loaded before the trusted import gate")
    root = _trusted_local_import_root()
    _verify_local_import_specs(root)
    _load_reviewed_local_modules(root)
    _verify_standard_import_machinery(reset_cache=True)
    return root


_PREIMPORT_TRUSTED_ROOT = _verify_preimport_startup_environment()

from e57_image2d_evidence import DecodedJpeg, canonical_json_bytes
from e57_stage_guard import assert_disjoint_output
from panorama_image2d_crosswalk import (
    CROSSWALK_NAME,
    FROZEN_CONFIGURATION,
    GRAND_HALL_CROSSWALK_PROFILE,
    MATRIX_NAME,
    CandidateVerification,
    CrosswalkProfile,
    CrosswalkConfiguration,
    Data3DSource,
    DependencyAttestation,
    DependencyImportPlan,
    FaceFeature,
    FeatureArtifact,
    GeneratorBinding,
    InputCustody,
    MatcherBackend,
    PanoramaFeature,
    PanoramaSource,
    RankingPolicy,
    RetrievalScore,
    ScanFeature,
    SourceBindings,
    build_crosswalk_manifest,
    build_native_scan_descriptor,
    build_panorama_descriptor,
    build_score_matrix_manifest,
    build_source_bindings,
    capture_generator_binding,
    capture_input_custody,
    collect_stable_panorama_inventory,
    configuration_digest,
    load_verified_image2d_evidence,
    publish_crosswalk_pack,
    prepare_dependency_import,
    rank_candidate_correspondences,
    score_complete_candidate_matrix,
    select_bidirectional_shortlist,
    sha256_bytes,
    verify_crosswalk_pack,
    verify_dependency_lock,
    verify_final_input_custody,
    verify_input_custody,
    verify_shortlist_candidates,
    verify_source_snapshots,
    verify_frozen_basis_report,
    GENERATOR_PATHS,
    DEPENDENCY_LOCK_RELATIVE_PATH,
)

_verify_standard_import_machinery(reset_cache=True)


REPO_ROOT = Path(__file__).resolve().parents[3]
LOCK_PATH = REPO_ROOT / DEPENDENCY_LOCK_RELATIVE_PATH


def _capture_local_module_bindings() -> dict[str, Any]:
    current = sys.modules.get(__name__)
    bindings = {
        name: current if name == _BUILDER_MODULE_NAME else sys.modules.get(name)
        for name in _LOCAL_GENERATOR_MODULE_NAMES
    }
    if any(module is None for module in bindings.values()):
        raise ValueError("local generator module binding is incomplete")
    return bindings


_LOCAL_MODULE_BINDINGS = _capture_local_module_bindings()


def _resolved_origin(value: object) -> Path | None:
    if not isinstance(value, str):
        return None
    try:
        return Path(value).resolve(strict=True)
    except (OSError, RuntimeError):
        return None


class VerifiedPathFinder:
    def __init__(self, site_root: Path, site_files: tuple[Path, ...]) -> None:
        self.site_root = site_root.resolve(strict=True)
        self.site_files = frozenset(site_files)
        self.site_directories = frozenset(
            parent
            for path in site_files
            for parent in path.parents
            if parent == self.site_root or _is_within(parent, self.site_root)
        )
        self.site_namespaces = frozenset(
            path.relative_to(self.site_root).parts[0].split(".", 1)[0]
            for path in site_files
        )
        self.base_roots = frozenset(_base_import_roots())
        self._find_spec = PathFinder.find_spec
        self.active = False

    def _verify_locations(self, locations: Any) -> None:
        if locations is None:
            return
        values = tuple(_resolved_origin(value) for value in locations)
        if not values or any(value not in self.site_directories for value in values):
            raise ImportError("dependency package search location is not allowlisted")

    def _verify_site_spec(self, spec: Any, origin: Path) -> None:
        loader = getattr(spec, "loader", None)
        loader_path = _resolved_origin(getattr(loader, "path", None))
        if (
            origin not in self.site_files
            or type(loader) not in (SourceFileLoader, ExtensionFileLoader)
            or loader_path != origin
        ):
            raise ImportError("dependency import origin is not allowlisted")
        self._verify_locations(getattr(spec, "submodule_search_locations", None))

    def _verify_base_spec(self, spec: Any, origin: Path) -> None:
        loader = getattr(spec, "loader", None)
        loader_path = _resolved_origin(getattr(loader, "path", None))
        if (
            not any(_is_within(origin, root) for root in self.base_roots)
            or type(loader) not in (SourceFileLoader, ExtensionFileLoader)
            or loader_path != origin
        ):
            raise ImportError("non-dependency import origin is outside the pinned base")
        locations = getattr(spec, "submodule_search_locations", None)
        if locations is not None:
            values = tuple(_resolved_origin(item) for item in locations)
            if any(
                value is None
                or not any(_is_within(value, root) for root in self.base_roots)
                for value in values
            ):
                raise ImportError("base package search location is outside the pinned base")

    def find_spec(
        self, fullname: str, path: Sequence[str] | None = None, target: Any = None
    ) -> Any:
        if not self.active:
            raise ImportError("dependency import allowlist is inactive")
        spec = self._find_spec(fullname, path, target)
        if spec is None:
            return None
        origin = _resolved_origin(getattr(spec, "origin", None))
        locations = getattr(spec, "submodule_search_locations", None)
        if origin is None:
            if locations is not None:
                raise ImportError("namespace package imports are forbidden")
            return spec
        if _is_within(origin, self.site_root):
            self._verify_site_spec(spec, origin)
        elif fullname.split(".", 1)[0] in self.site_namespaces:
            raise ImportError("dependency namespace escaped its allowlisted site root")
        else:
            self._verify_base_spec(spec, origin)
        return spec


def _verify_guarded_import_machinery(guard: VerifiedPathFinder) -> None:
    if type(sys.meta_path) is not list or tuple(sys.meta_path) != (
        BuiltinImporter, FrozenImporter, guard,
    ):
        raise ValueError("guarded Python meta path drifted")
    if not guard.active:
        raise ValueError("dependency import allowlist is inactive")
    _verify_import_primitives()
    _verify_standard_path_hooks()
    if type(sys.path_importer_cache) is not dict:
        raise ValueError("Python path importer cache must be an exact dictionary")


def _verify_local_module_origins(repo_root: Path) -> None:
    root = repo_root.resolve(strict=True)
    relative_by_name = {Path(value).stem: value for value in GENERATOR_PATHS}
    if set(relative_by_name) != set(_LOCAL_GENERATOR_MODULE_NAMES):
        raise ValueError("local generator module inventory drifted")
    for name in _LOCAL_GENERATOR_MODULE_NAMES:
        module = _LOCAL_MODULE_BINDINGS[name]
        active = sys.modules.get(__name__) if name == _BUILDER_MODULE_NAME else sys.modules.get(name)
        if active is not module:
            raise ValueError(f"local generator module binding changed: {name}")
        expected = (root / Path(relative_by_name[name])).resolve(strict=True)
        actual = _resolved_origin(getattr(module, "__file__", None))
        if actual != expected:
            raise ValueError(f"loaded local generator module origin drifted: {name}")
        if name != _BUILDER_MODULE_NAME or __name__ != "__main__":
            spec = getattr(module, "__spec__", None)
            actual_spec = _resolved_origin(getattr(spec, "origin", None))
            if actual_spec != expected:
                raise ValueError(f"local generator module spec origin drifted: {name}")


def _verify_startup_environment() -> None:
    if not sys.dont_write_bytecode:
        raise ValueError("the matcher must run under Python -B with bytecode writes disabled")
    if not (
        sys.flags.isolated == 1
        and sys.flags.no_site == 1
        and sys.flags.no_user_site == 1
        and sys.flags.ignore_environment == 1
        and sys.flags.safe_path
        and sys.pycache_prefix == "NUL"
    ):
        raise ValueError("the matcher requires the isolated no-site worker boundary")
    if not _python_path_environment_absent():
        raise ValueError("the matcher forbids PYTHONPATH, including an empty value")
    if "site" in sys.modules:
        raise ValueError("the matcher forbids Python site initialization")
    if _startup_hook_files() or any(
        name in sys.modules for name in _CUSTOM_STARTUP_MODULE_NAMES
    ):
        raise ValueError("unbound Python startup hook files or modules are forbidden")
    _verify_import_path()
    _verify_standard_import_machinery(reset_cache=True)
    _verify_local_import_specs(_PREIMPORT_TRUSTED_ROOT)
    _verify_local_module_origins(REPO_ROOT)


_verify_local_module_origins(REPO_ROOT)


@dataclass(frozen=True)
class DerivedCrosswalk:
    matrix: dict[str, Any]
    rows: list[dict[str, Any]]
    panoramas: list[PanoramaSource]
    scans: list[Data3DSource]
    bindings: SourceBindings
    configuration: CrosswalkConfiguration
    generator: GeneratorBinding
    dependency: DependencyAttestation


@dataclass(frozen=True)
class PreparedCrosswalkRun:
    backend: OpenCvSiftBackend
    output: Path
    wheel_root: Path
    reviewed_git_sha: str
    basis_report: Path
    repo_root: Path
    generator: GeneratorBinding
    dependency: DependencyAttestation
    report_snapshot: Any
    custody: InputCustody
    derived: DerivedCrosswalk


@dataclass(frozen=True)
class CoherentFit:
    errors: Any
    inliers: Any
    global_reflection_applied: bool


@dataclass(frozen=True)
class LoadedNumericDependencies:
    environment: dict[str, str]
    cv2: Any
    np: Any
    bindings: dict[str, Any]
    origins: dict[str, Path]
    import_path: tuple[str, ...]
    site_root: Path
    import_guard: VerifiedPathFinder


class ExistingPathWriteSeal:
    def __init__(self, root: Path, handles: tuple[int, ...], close_handle: Any) -> None:
        self.root = root
        self._handles = handles
        self._close_handle = close_handle
        self.active = True

    def close(self) -> None:
        if not self.active:
            return
        failures: list[BaseException] = []
        remaining: list[int] = []
        for handle in reversed(self._handles):
            try:
                if not self._close_handle(handle):
                    raise OSError(f"could not close dependency seal handle: {handle}")
            except BaseException as error:
                failures.append(error)
                remaining.append(handle)
        self._handles = tuple(reversed(remaining))
        self.active = bool(self._handles)
        if failures:
            primary = failures[0]
            for error in failures[1:]:
                primary.add_note(f"another dependency seal close failed: {error!r}")
            raise primary

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass


@dataclass(frozen=True)
class PreparedNumericBackend:
    plan: DependencyImportPlan
    loaded: LoadedNumericDependencies
    wheel_root: Path
    seal: ExistingPathWriteSeal
    runtime_controls: dict[str, Any]
    attestation: DependencyAttestation


def _identity_seed(*digests: str) -> int:
    material = b"".join(bytes.fromhex(value) for value in digests)
    return int.from_bytes(hashlib.sha256(material).digest()[:8], "little")


def _signed_seed(seed: int) -> int:
    value = seed & 0x7FFFFFFF
    return value if value else 1


def _trusted_dependency_site_root() -> Path:
    executable = Path(sys.executable).resolve(strict=True)
    environment_root = executable.parent.parent.resolve(strict=True)
    if executable != environment_root / "Scripts" / "python.exe":
        raise ValueError("the pinned dependency interpreter path drifted")
    configuration = environment_root / "pyvenv.cfg"
    if not configuration.is_file() or _windows_reparse_point(configuration):
        raise ValueError("the pinned dependency environment lacks a real pyvenv.cfg")
    root = environment_root / "Lib" / "site-packages"
    resolved = root.resolve(strict=True)
    if not resolved.is_dir() or _windows_reparse_point(resolved):
        raise ValueError("the pinned dependency site root is unavailable")
    return resolved


def _windows_reparse_point(path: Path) -> bool:
    attributes = getattr(path.stat(follow_symlinks=False), "st_file_attributes", 0)
    return path.is_symlink() or bool(attributes & 0x400)


def _activate_dependency_import_path(
    site_root: Path, guard: VerifiedPathFinder
) -> tuple[str, ...]:
    _verify_import_path()
    resolved = site_root.resolve(strict=True)
    if any(Path(value).resolve(strict=True) == resolved for value in sys.path):
        raise ValueError("dependency site root was exposed before verification")
    _verify_standard_import_machinery(reset_cache=True)
    sys.meta_path[:] = [BuiltinImporter, FrozenImporter, guard]
    guard.active = True
    sys.path.append(str(resolved))
    _verify_import_path(resolved)
    _verify_guarded_import_machinery(guard)
    return tuple(sys.path)


def _deactivate_dependency_import_path(
    site_root: Path, guard: VerifiedPathFinder
) -> bool:
    expected = (BuiltinImporter, FrozenImporter, guard)
    drifted = tuple(sys.meta_path) != expected
    guard.active = False
    if not drifted:
        sys.meta_path[:] = [BuiltinImporter, FrozenImporter, PathFinder]
    resolved = site_root.resolve(strict=True)
    sys.path[:] = [
        value for value in sys.path
        if Path(value).resolve(strict=True) != resolved
    ]
    sys.path_importer_cache.clear()
    return drifted


def _close_numeric_runtime(
    site_root: Path, guard: VerifiedPathFinder, seal: ExistingPathWriteSeal
) -> bool:
    failure: BaseException | None = None
    drifted = False
    if guard.active:
        try:
            drifted = _deactivate_dependency_import_path(site_root, guard)
        except BaseException as error:
            failure = error
    try:
        seal.close()
    except BaseException as error:
        if failure is None:
            failure = error
        else:
            failure.add_note(f"dependency seal close also failed: {error!r}")
    if failure is not None:
        if drifted:
            failure.add_note("guarded Python meta path drifted before cleanup")
        raise failure
    return drifted


def _cleanup_failed_runtime(
    site_root: Path, guard: VerifiedPathFinder | None,
    seal: ExistingPathWriteSeal, original: BaseException,
) -> None:
    try:
        if guard is None:
            seal.close()
        else:
            _close_numeric_runtime(site_root, guard, seal)
    except BaseException as cleanup_error:
        original.add_note(f"numeric runtime cleanup also failed: {cleanup_error!r}")


def _windows_file_functions() -> tuple[Any, Any, int]:
    if os.name != "nt":
        raise ValueError("dependency existing-path write sealing requires Windows")
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = (
        wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
        wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
    )
    create_file.restype = wintypes.HANDLE
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    return create_file, close_handle, ctypes.c_void_p(-1).value


def _existing_paths_to_write_seal(root: Path) -> list[tuple[Path, bool]]:
    paths = [(root, True)]
    for directory, names, files in os.walk(root, followlinks=False):
        current = Path(directory)
        paths.extend((current / name, True) for name in sorted(names))
        paths.extend((current / name, False) for name in sorted(files))
    return paths


def _open_existing_path_write_seal_handle(
    create_file: Any, invalid_handle: int, path: Path, directory: bool
) -> int:
    import ctypes

    generic_read = 0x80000000
    file_share_read = 0x00000001
    open_existing = 3
    backup_semantics = 0x02000000 if directory else 0x00000080
    handle = create_file(
        str(path), generic_read, file_share_read, None,
        open_existing, backup_semantics, None,
    )
    if handle == invalid_handle:
        error = ctypes.get_last_error()
        raise OSError(error, f"could not write-seal dependency path: {path}")
    return int(handle)


def _seal_existing_dependency_paths(root: Path) -> ExistingPathWriteSeal:
    create_file, close_handle, invalid_handle = _windows_file_functions()
    handles: list[int] = []
    try:
        for path, directory in _existing_paths_to_write_seal(root):
            handles.append(
                _open_existing_path_write_seal_handle(
                    create_file, invalid_handle, path, directory
                )
            )
    except BaseException:
        for handle in reversed(handles):
            close_handle(handle)
        raise
    return ExistingPathWriteSeal(root, tuple(handles), close_handle)


def _activate_numeric_environment(
    configuration: CrosswalkConfiguration,
) -> dict[str, str]:
    if type(sys.modules) is not dict:
        raise ValueError("Python modules container must be an exact dictionary")
    preexisting = sorted(
        name for name in sys.modules
        if name in ("cv2", "numpy") or name.startswith(("cv2.", "numpy."))
    )
    if preexisting:
        raise ValueError(
            "numeric dependencies were imported before deterministic environment controls"
        )
    environment = dict(configuration.thread_environment)
    for name, value in environment.items():
        os.environ[name] = value
    return environment


def _verify_standard_import_state(
    import_path: tuple[str, ...], site_root: Path, guard: VerifiedPathFinder
) -> None:
    if tuple(sys.path) != import_path:
        raise ValueError("numeric dependency import path changed during binding")
    _verify_import_path(site_root)
    _verify_guarded_import_machinery(guard)
    sys.path_importer_cache.clear()


def _numeric_import_origins(
    plan: DependencyImportPlan, import_path: tuple[str, ...]
) -> dict[str, Path]:
    packages = {"numpy": "numpy", "cv2": "opencv-python-headless"}
    origins: dict[str, Path] = {}
    for module_name, package_name in packages.items():
        spec = PathFinder.find_spec(module_name, list(import_path))
        origin = None if spec is None else _resolved_origin(spec.origin)
        expected = plan.package_origin_paths.get(package_name)
        loader = None if spec is None else spec.loader
        locations = None if spec is None else spec.submodule_search_locations
        search_roots = () if locations is None else tuple(
            _resolved_origin(value) for value in locations
        )
        if (
            expected is None
            or spec is None
            or origin != expected
            or type(loader) is not SourceFileLoader
            or _resolved_origin(getattr(loader, "path", None)) != expected
            or search_roots != (expected.parent,)
        ):
            raise ValueError(
                f"numeric dependency import origin is not bound: {module_name}"
            )
        origins[module_name] = expected
    return origins


def _verify_loaded_numeric_identity(
    bindings: dict[str, Any], origins: dict[str, Path], import_path: tuple[str, ...],
    site_root: Path, guard: VerifiedPathFinder,
) -> None:
    _verify_standard_import_state(import_path, site_root, guard)
    for name, module in bindings.items():
        if sys.modules.get(name) is not module:
            raise ValueError(f"numeric dependency module binding changed: {name}")
        if _resolved_origin(getattr(module, "__file__", None)) != origins[name]:
            raise ValueError(f"numeric dependency module origin drifted: {name}")
        spec = getattr(module, "__spec__", None)
        if _resolved_origin(getattr(spec, "origin", None)) != origins[name]:
            raise ValueError(f"numeric dependency module spec origin drifted: {name}")


def _load_numeric_dependencies(
    environment: dict[str, str], plan: DependencyImportPlan, site_root: Path,
    guard: VerifiedPathFinder,
) -> LoadedNumericDependencies:
    import_path = _activate_dependency_import_path(site_root, guard)
    _verify_standard_import_state(import_path, site_root, guard)
    origins = _numeric_import_origins(plan, import_path)
    import cv2
    import numpy as np
    import numpy.core._multiarray_umath as multiarray_umath
    import numpy.linalg._umath_linalg as umath_linalg

    bindings = {"cv2": cv2, "numpy": np}
    _verify_loaded_numeric_identity(bindings, origins, import_path, site_root, guard)
    native = plan.runtime_file_paths["numpy"]
    if _resolved_origin(multiarray_umath.__file__) != native["multiarray"]:
        raise ValueError("loaded NumPy multiarray origin drifted")
    if _resolved_origin(umath_linalg.__file__) != native["umathLinalg"]:
        raise ValueError("loaded NumPy linalg origin drifted")
    return LoadedNumericDependencies(
        environment, cv2, np, bindings, origins, import_path, site_root, guard
    )


def _numeric_runtime_controls(
    environment: dict[str, str], cv2: Any, seal: ExistingPathWriteSeal,
    guard: VerifiedPathFinder,
) -> dict[str, Any]:
    return {
        "dependencyExistingPathsWriteSealed": bool(seal.active),
        "dependencyImportAllowlistEnforced": bool(guard.active),
        "environmentControls": environment,
        "environmentControlsSetBeforeImports": True,
        "opencvBuildInformationSha256": sha256_bytes(
            cv2.getBuildInformation().encode("utf-8")
        ),
        "opencvCpuFeaturesLine": cv2.getCPUFeaturesLine(),
        "opencvOpenCl": bool(cv2.ocl.useOpenCL()),
        "opencvThreads": int(cv2.getNumThreads()),
        "pythonPathEnvironmentAbsent": _python_path_environment_absent(),
        "pythonDontWriteBytecode": bool(sys.dont_write_bytecode),
        "startupHookFiles": _startup_hook_files(),
        "pythonBytecodeCachePrefix": sys.pycache_prefix,
        "pythonIgnoreEnvironment": bool(sys.flags.ignore_environment),
        "pythonIsolated": bool(sys.flags.isolated),
        "pythonNoSite": bool(sys.flags.no_site),
        "pythonSafePath": bool(sys.flags.safe_path),
        "reviewedLocalModulesExplicitlyLoaded": True,
        "userSiteEnabled": False,
        "verifiedSiteRootAddedAfterSeal": True,
    }


def _distribution_metadata_version(site_root: Path, name: str) -> str:
    normalized = name.replace("-", "_")
    paths = list(site_root.glob(f"{normalized}-*.dist-info/METADATA"))
    if len(paths) != 1:
        raise ValueError(f"installed dependency metadata is ambiguous: {name}")
    path = paths[0]
    before = path.stat()
    content = path.read_bytes()
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError(f"installed dependency metadata changed: {name}")
    try:
        lines = content.decode("utf-8").splitlines()
    except UnicodeError as error:
        raise ValueError(f"installed dependency metadata is invalid: {name}") from error
    versions = [line.removeprefix("Version: ") for line in lines if line.startswith("Version: ")]
    if len(versions) != 1 or not versions[0]:
        raise ValueError(f"installed dependency version is missing: {name}")
    return versions[0]


def _prepare_numeric_backend(
    wheel_root: Path, configuration: CrosswalkConfiguration
) -> PreparedNumericBackend:
    environment = _activate_numeric_environment(configuration)
    dependency_root = wheel_root.resolve(strict=True)
    site_root = _trusted_dependency_site_root()
    seal = _seal_existing_dependency_paths(site_root)
    guard: VerifiedPathFinder | None = None
    try:
        plan = prepare_dependency_import(LOCK_PATH, dependency_root, site_root)
        guard = VerifiedPathFinder(site_root, plan.import_origin_paths)
        loaded = _load_numeric_dependencies(environment, plan, site_root, guard)
        loaded.cv2.setNumThreads(1)
        loaded.cv2.ocl.setUseOpenCL(False)
        observed_versions = {
            "numpy": str(loaded.np.__version__),
            "opencv-python-headless": _distribution_metadata_version(
                site_root, "opencv-python-headless"
            ),
        }
        if not observed_versions["opencv-python-headless"].startswith(
            str(loaded.cv2.__version__) + "."
        ):
            raise ValueError("loaded OpenCV module version differs from its distribution")
        if observed_versions != plan.installed_versions:
            raise ValueError("loaded dependency versions differ from the import plan")
        controls = _numeric_runtime_controls(environment, loaded.cv2, seal, guard)
        _, attestation = verify_dependency_lock(
            LOCK_PATH, dependency_root, observed_versions,
            plan.runtime_file_paths, controls, plan.distribution_roots,
        )
        if attestation != plan.attestation:
            raise ValueError("loaded dependency attestation differs from the import plan")
        return PreparedNumericBackend(
            plan, loaded, dependency_root, seal, controls, attestation
        )
    except BaseException as error:
        _cleanup_failed_runtime(site_root, guard, seal, error)
        raise


class OpenCvSiftBackend(MatcherBackend):
    def __init__(
        self,
        wheel_root: Path,
        configuration: CrosswalkConfiguration = FROZEN_CONFIGURATION,
    ) -> None:
        if configuration != FROZEN_CONFIGURATION:
            raise ValueError("the matcher requires the frozen reviewed configuration")
        _verify_startup_environment()
        prepared = _prepare_numeric_backend(wheel_root, configuration)
        try:
            self._bind_prepared(configuration, prepared)
        except BaseException as error:
            _cleanup_failed_runtime(
                prepared.loaded.site_root, prepared.loaded.import_guard,
                prepared.seal, error,
            )
            raise

    def _bind_prepared(
        self, configuration: CrosswalkConfiguration, prepared: PreparedNumericBackend
    ) -> None:
        plan, loaded = prepared.plan, prepared.loaded
        self.configuration = configuration
        self.cv2, self.np = loaded.cv2, loaded.np
        self.dependency_versions = dict(plan.installed_versions)
        self.distribution_roots = dict(plan.distribution_roots)
        self.runtime_file_paths = {
            name: dict(values) for name, values in plan.runtime_file_paths.items()
        }
        self.runtime_controls = prepared.runtime_controls
        self.dependency_wheel_root = prepared.wheel_root
        self.package_origin_paths = dict(plan.package_origin_paths)
        self._numeric_bindings, self._numeric_origins = loaded.bindings, loaded.origins
        self._numeric_import_path = loaded.import_path
        self._dependency_site_root = loaded.site_root
        self._dependency_import_guard = loaded.import_guard
        self._dependency_path_seal = prepared.seal
        self.initial_dependency_attestation = prepared.attestation
        self._closed = False

    def close(self) -> None:
        if getattr(self, "_closed", False):
            return
        drifted = _close_numeric_runtime(
            self._dependency_site_root,
            self._dependency_import_guard,
            self._dependency_path_seal,
        )
        self._closed = (
            not self._dependency_import_guard.active
            and not self._dependency_path_seal.active
        )
        if drifted:
            raise ValueError("guarded Python meta path drifted before backend close")

    def __enter__(self) -> OpenCvSiftBackend:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def verify_dependency_bindings(self) -> None:
        if not self._dependency_path_seal.active:
            raise ValueError("dependency existing-path write seal is no longer active")
        if set(self.distribution_roots.values()) != {self._dependency_path_seal.root}:
            raise ValueError("dependency existing-path write-seal root drifted")
        _verify_loaded_numeric_identity(
            self._numeric_bindings,
            self._numeric_origins,
            self._numeric_import_path,
            self._dependency_site_root,
            self._dependency_import_guard,
        )

    def decode_jpeg(self, content: bytes) -> DecodedJpeg:
        if not content.startswith(b"\xff\xd8") or not content.endswith(b"\xff\xd9"):
            raise ValueError("JPEG lacks exact SOI/EOI markers")
        encoded = self.np.frombuffer(content, dtype=self.np.uint8)
        image = self.cv2.imdecode(encoded, self.cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("JPEG failed a full OpenCV decode")
        rgb = self.cv2.cvtColor(image, self.cv2.COLOR_BGR2RGB)
        return DecodedJpeg(rgb.shape[1], rgb.shape[0], "RGB", "JPEG")

    def _extract(
        self, sha256: str, content: bytes, max_width: int, limit: int
    ) -> FeatureArtifact:
        encoded = self.np.frombuffer(content, dtype=self.np.uint8)
        image = self.cv2.imdecode(encoded, self.cv2.IMREAD_GRAYSCALE)
        if image is None:
            raise ValueError("feature source failed grayscale decode")
        height, width = image.shape
        scale = min(1.0, max_width / width)
        shape = (round(width * scale), round(height * scale))
        resized = self.cv2.resize(image, shape, interpolation=self.cv2.INTER_AREA)
        detector = self.configuration.detector
        self.cv2.setRNGSeed(_signed_seed(_identity_seed(sha256)))
        sift = self.cv2.SIFT_create(
            limit,
            3,
            detector.contrast_threshold_micros / 1_000_000,
            detector.edge_threshold,
            detector.sigma_micros / 1_000_000,
        )
        keypoints, descriptors = sift.detectAndCompute(resized, None)
        points, matrix = self._stable_features(keypoints, descriptors)
        return FeatureArtifact(sha256, shape[0], shape[1], points, matrix)

    def _stable_features(
        self, keypoints: Sequence[Any], descriptors: Any
    ) -> tuple[Any, Any]:
        if descriptors is None:
            return (
                self.np.empty((0, 2), self.np.float32),
                self.np.empty((0, 128), self.np.float32),
            )
        order = sorted(
            range(len(keypoints)),
            key=lambda index: (
                round(keypoints[index].pt[0], 6),
                round(keypoints[index].pt[1], 6),
                round(keypoints[index].size, 6),
                round(keypoints[index].angle, 6),
                round(keypoints[index].response, 9),
                keypoints[index].octave,
                descriptors[index].tobytes(),
            ),
        )
        points = self.np.asarray(
            [keypoints[index].pt for index in order], dtype=self.np.float32
        )
        return points, self.np.asarray(descriptors[order], dtype=self.np.float32)

    def extract_panorama(self, sha256: str, content: bytes) -> FeatureArtifact:
        detector = self.configuration.detector
        return self._extract(
            sha256,
            content,
            detector.panorama_max_width,
            detector.panorama_feature_limit,
        )

    def extract_face(
        self, sha256: str, _intrinsics: Intrinsics, content: bytes
    ) -> FeatureArtifact:
        detector = self.configuration.detector
        return self._extract(
            sha256,
            content,
            detector.face_max_width,
            detector.face_feature_limit,
        )

    def _global_index(
        self, scans: Sequence[ScanFeature]
    ) -> tuple[Any, list[str]]:
        descriptors = []
        labels = []
        for scan in sorted(scans, key=lambda item: item.data3d_guid):
            for face in sorted(scan.faces, key=lambda item: item.face_sha256):
                matrix = self._descriptors(face.feature)
                descriptors.append(matrix)
                labels.extend([scan.data3d_guid] * len(matrix))
        if not descriptors or sum(len(item) for item in descriptors) == 0:
            return None, labels
        matrix = self.np.concatenate(descriptors).astype(self.np.float32)
        retrieval = self.configuration.retrieval
        matcher = self.cv2.FlannBasedMatcher(
            dict(algorithm=1, trees=retrieval.flann_trees),
            dict(checks=retrieval.flann_checks),
        )
        guid_digests = [
            hashlib.sha256(scan.data3d_guid.encode()).hexdigest() for scan in scans
        ]
        self.cv2.setRNGSeed(
            _signed_seed(_identity_seed(*sorted(guid_digests)))
        )
        matcher.add([matrix])
        matcher.train()
        return matcher, labels

    def complete_retrieval(
        self,
        panoramas: Sequence[PanoramaFeature],
        scans: Sequence[ScanFeature],
    ) -> Sequence[RetrievalScore]:
        matcher, labels = self._global_index(scans)
        scan_ids = sorted(scan.data3d_guid for scan in scans)
        results = []
        for panorama in sorted(panoramas, key=lambda item: item.panorama_sha256):
            votes = {guid: [0, 0] for guid in scan_ids}
            if matcher is not None:
                self._accumulate_retrieval(
                    matcher,
                    labels,
                    self._descriptors(panorama.feature),
                    votes,
                )
            results.extend(
                RetrievalScore(
                    panorama.panorama_sha256,
                    guid,
                    votes[guid][0],
                    votes[guid][1],
                )
                for guid in scan_ids
            )
        return results

    def _accumulate_retrieval(
        self,
        matcher: Any,
        labels: list[str],
        descriptors: Any,
        votes: dict[str, list[int]],
    ) -> None:
        if len(descriptors) == 0:
            return
        retrieval = self.configuration.retrieval
        count = min(retrieval.nearest_descriptor_count, len(labels))
        for matches in matcher.knnMatch(descriptors, k=count):
            best = {}
            for match in matches:
                guid = labels[match.trainIdx]
                best[guid] = min(
                    best.get(guid, math.inf), float(match.distance)
                )
            for guid, distance in best.items():
                threshold = retrieval.distance_threshold_micros / 1_000_000
                if distance >= threshold:
                    continue
                votes[guid][0] += int(
                    math.floor(
                        (1.0 - distance / threshold)
                        * retrieval.score_scale
                        + 0.5
                    )
                )
                votes[guid][1] += 1

    def _descriptors(self, feature: FeatureArtifact) -> Any:
        matrix = self.np.asarray(feature.descriptors)
        if (
            matrix.ndim != 2
            or matrix.shape[1] != 128
            or matrix.dtype != self.np.float32
        ):
            raise ValueError("SIFT descriptor matrix contract drifted")
        return matrix

    def _points(self, feature: FeatureArtifact) -> Any:
        points = self.np.asarray(feature.points)
        if points.ndim != 2 or points.shape[1] != 2:
            raise ValueError("feature point matrix contract drifted")
        return points

    def _ratio_matches(
        self, face: FaceFeature, panorama: PanoramaFeature
    ) -> list[Any]:
        source = self._descriptors(face.feature)
        target = self._descriptors(panorama.feature)
        if len(source) < 3 or len(target) < 3:
            return []
        matcher = self.cv2.BFMatcher(self.cv2.NORM_L2)
        ratio = self.configuration.verification.ratio_micros / 1_000_000
        candidates = [pair[0] for pair in matcher.knnMatch(source, target, k=2) if len(pair) == 2 if pair[0].distance < ratio * pair[1].distance]
        candidates.sort(key=lambda item: (item.distance, item.queryIdx, item.trainIdx))
        used = set()
        result = []
        for match in candidates:
            if match.trainIdx not in used:
                used.add(match.trainIdx)
                result.append(match)
        return result

    def verify_candidate(
        self, panorama: PanoramaFeature, scan: ScanFeature
    ) -> CandidateVerification:
        source, target, labels, ratio_matches = self._candidate_rays(panorama, scan)
        fit = self._rotation_ransac(
            source, target, self._candidate_seed(panorama, scan)
        )
        counts = self._face_inlier_counts(labels, fit)
        supported = sum(
            count >= self.configuration.verification.supported_face_inliers
            for _, count in counts
        )
        coherent = (
            fit is not None
            and supported >= self.configuration.ranking.minimum_supported_faces
        )
        errors = [] if fit is None else fit.errors[fit.inliers]
        median, p95 = self._residual_metrics(errors)
        reflection = None if fit is None else fit.global_reflection_applied
        inliers = 0 if fit is None else int(fit.inliers.sum())
        return CandidateVerification(
            panorama.panorama_sha256,
            scan.data3d_guid,
            inliers,
            supported,
            ratio_matches,
            median,
            p95,
            reflection,
            coherent,
            counts,
        )

    def _candidate_rays(
        self, panorama: PanoramaFeature, scan: ScanFeature
    ) -> tuple[Any, Any, Any, int]:
        source, target, labels = [], [], []
        selected = self._unique_scan_matches(panorama, scan)
        for face in sorted(scan.faces, key=lambda item: item.face_index):
            matches = [match for owner, match in selected if owner.face_index == face.face_index]
            face_points = self._points(face.feature)[
                [item.queryIdx for item in matches]
            ]
            pano_points = self._points(panorama.feature)[
                [item.trainIdx for item in matches]
            ]
            source.append(self._cubemap_rays(face_points, face))
            target.append(self._panorama_rays(pano_points, panorama.feature))
            labels.extend([face.face_index] * len(matches))
        if not source:
            return (
                self.np.empty((0, 3)),
                self.np.empty((0, 3)),
                self.np.empty(0, int),
                0,
            )
        return (
            self.np.concatenate(source),
            self.np.concatenate(target),
            self.np.asarray(labels),
            len(selected),
        )

    def _unique_scan_matches(
        self, panorama: PanoramaFeature, scan: ScanFeature
    ) -> list[tuple[FaceFeature, Any]]:
        candidates = [
            (face, match)
            for face in sorted(scan.faces, key=lambda item: item.face_index)
            for match in self._ratio_matches(face, panorama)
        ]
        candidates.sort(
            key=lambda item: (
                item[1].distance,
                item[0].face_index,
                item[1].queryIdx,
                item[1].trainIdx,
            )
        )
        used = set()
        selected = []
        for face, match in candidates:
            if match.trainIdx not in used:
                used.add(match.trainIdx)
                selected.append((face, match))
        return selected

    def _pinhole_rays(self, points: Any, face: FaceFeature) -> Any:
        intrinsics = face.intrinsics
        scale_x = face.feature.width / intrinsics.width
        scale_y = face.feature.height / intrinsics.height
        focal_x = intrinsics.focal_length / intrinsics.pixel_width * scale_x
        focal_y = intrinsics.focal_length / intrinsics.pixel_height * scale_y
        x = (
            points[:, 0] - intrinsics.principal_point_x * scale_x
        ) / focal_x
        y = (
            points[:, 1] - intrinsics.principal_point_y * scale_y
        ) / focal_y
        rays = self.np.column_stack([self.np.ones(len(points)), x, y])
        return rays / self.np.linalg.norm(rays, axis=1, keepdims=True)

    def _cubemap_rays(self, points: Any, face: FaceFeature) -> Any:
        basis = self.configuration.cube_faces[face.face_index]
        if basis.face_index != face.face_index:
            raise ValueError("frozen cubeface basis index drifted")
        matrix = self.np.column_stack([basis.forward, basis.right, basis.down])
        rays = self._pinhole_rays(points, face) @ matrix.T
        return rays / self.np.linalg.norm(rays, axis=1, keepdims=True)

    def _panorama_rays(self, points: Any, feature: FeatureArtifact) -> Any:
        longitude = (points[:, 0] / feature.width) * (2 * self.np.pi)
        latitude = self.np.pi / 2 - points[:, 1] / feature.height * self.np.pi
        cosine = self.np.cos(latitude)
        return self.np.column_stack(
            [
                cosine * self.np.cos(longitude),
                cosine * self.np.sin(longitude),
                self.np.sin(latitude),
            ]
        )

    def _fit_rotation(self, source: Any, target: Any) -> Any:
        left, _, right = self.np.linalg.svd(source.T @ target)
        rotation = right.T @ left.T
        if self.np.linalg.det(rotation) < 0:
            right[-1] *= -1
            rotation = right.T @ left.T
        return rotation

    def _angular_errors(self, source: Any, target: Any, rotation: Any) -> Any:
        predicted = source @ rotation.T
        cosine = self.np.sum(predicted * target, axis=1)
        return self.np.degrees(self.np.arccos(self.np.clip(cosine, -1, 1)))

    def _rotation_ransac(
        self, source: Any, target: Any, seed: int
    ) -> CoherentFit | None:
        if len(source) < 3 or len(source) != len(target):
            return None
        options = (
            (False, True)
            if self.configuration.verification.allow_global_reflection
            else (False,)
        )
        results = [
            self._fit_global_chirality(source, target, seed, reflected)
            for reflected in options
        ]
        valid = [item for item in results if item is not None]
        if not valid:
            return None
        return max(valid, key=self._coherent_fit_score)

    def _fit_global_chirality(
        self,
        source: Any,
        target: Any,
        seed: int,
        reflected: bool,
    ) -> CoherentFit | None:
        candidate = source.copy()
        if reflected:
            if self.configuration.verification.global_reflection_axis != "scanner_y":
                raise ValueError("unsupported frozen global-reflection axis")
            candidate[:, 1] *= -1
        generator = self.np.random.default_rng(seed ^ int(reflected))
        threshold = (
            self.configuration.verification.inlier_threshold_microdegrees
            / 1_000_000
        )
        best = None
        for _ in range(self.configuration.verification.iterations):
            sample = generator.choice(len(candidate), 3, replace=False)
            errors = self._angular_errors(
                candidate,
                target,
                self._fit_rotation(candidate[sample], target[sample]),
            )
            mask = errors < threshold
            if int(mask.sum()) < 3:
                continue
            errors = self._angular_errors(
                candidate,
                target,
                self._fit_rotation(candidate[mask], target[mask]),
            )
            fit = CoherentFit(errors, errors < threshold, reflected)
            if best is None or self._coherent_fit_score(
                fit
            ) > self._coherent_fit_score(best):
                best = fit
        return best

    def _coherent_fit_score(self, fit: CoherentFit) -> tuple[int, float, int]:
        errors = fit.errors[fit.inliers]
        median = math.inf if len(errors) == 0 else float(self.np.median(errors))
        return (
            int(fit.inliers.sum()),
            -median,
            -int(fit.global_reflection_applied),
        )

    def _candidate_seed(
        self, panorama: PanoramaFeature, scan: ScanFeature
    ) -> int:
        guid = hashlib.sha256(scan.data3d_guid.encode()).hexdigest()
        faces = [
            face.face_sha256
            for face in sorted(scan.faces, key=lambda item: item.face_index)
        ]
        config = configuration_digest(self.configuration)
        return _identity_seed(panorama.panorama_sha256, guid, *faces, config)

    def _face_inlier_counts(
        self, labels: Any, fit: CoherentFit | None
    ) -> tuple[tuple[int, int], ...]:
        if fit is None:
            return tuple((index, 0) for index in range(6))
        return tuple(
            (index, int(((labels == index) & fit.inliers).sum()))
            for index in range(6)
        )

    def _residual_metrics(
        self, errors: Sequence[float]
    ) -> tuple[int | None, int | None]:
        if len(errors) == 0:
            return None, None
        values = self.np.asarray(errors, dtype=self.np.float64)
        median = int(math.floor(float(self.np.median(values)) * 1_000_000 + 0.5))
        p95 = int(
            math.floor(float(self.np.percentile(values, 95)) * 1_000_000 + 0.5)
        )
        return median, p95


def _require_safe_output(output: Path) -> None:
    if os.name != "nt":
        raise ValueError("crosswalk publication requires Windows no-replace semantics")
    drive = output.drive
    if len(drive) != 2 or drive[1] != ":" or not drive[0].isalpha():
        raise ValueError("crosswalk output requires an ordinary local drive-letter path")
    if drive[0].upper() == "C":
        raise ValueError("crosswalk output cannot use the system C: drive")
    parent = output.parent
    while parent != parent.parent and not parent.exists():
        parent = parent.parent
    if parent.is_symlink() or parent.resolve() != parent.absolute():
        raise ValueError("crosswalk output parent chain cannot contain links or reparses")


def _derive_features(
    panoramas: Sequence[PanoramaSource],
    scans: Sequence[Data3DSource],
    backend: MatcherBackend,
) -> tuple[list[PanoramaFeature], list[ScanFeature]]:
    panorama_features = [
        build_panorama_descriptor(item, backend) for item in panoramas
    ]
    scan_features = [build_native_scan_descriptor(item, backend) for item in scans]
    verify_source_snapshots(panoramas, scans)
    return panorama_features, scan_features


def _derive_crosswalk(
    panoramas: list[PanoramaSource],
    scans: list[Data3DSource],
    backend: MatcherBackend,
    profile: CrosswalkProfile,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
) -> DerivedCrosswalk:
    configuration = backend.configuration
    panorama_features, scan_features = _derive_features(panoramas, scans, backend)
    scores = score_complete_candidate_matrix(
        panorama_features, scan_features, backend
    )
    shortlist = select_bidirectional_shortlist(scores, configuration.ranking)
    verified = verify_shortlist_candidates(
        shortlist, panorama_features, scan_features, backend
    )
    verify_source_snapshots(panoramas, scans)
    rows = rank_candidate_correspondences(
        [item.sha256 for item in panoramas],
        scores,
        verified,
        configuration.ranking,
    )
    bindings = build_source_bindings(panoramas, scans, profile)
    panorama_ids = [item.sha256 for item in panoramas]
    scan_ids = [item.guid for item in scans]
    matrix = build_score_matrix_manifest(
        scores,
        bindings,
        configuration,
        generator,
        dependency,
        panorama_ids,
        scan_ids,
    )
    return DerivedCrosswalk(
        matrix,
        rows,
        panoramas,
        scans,
        bindings,
        configuration,
        generator,
        dependency,
    )


def _load_sources(
    panorama_root: Path,
    panorama_manifest: Path,
    image2d_root: Path,
    backend: MatcherBackend,
    profile: CrosswalkProfile,
) -> tuple[list[PanoramaSource], list[Data3DSource]]:
    panoramas = collect_stable_panorama_inventory(
        panorama_root, panorama_manifest, profile, backend.decode_jpeg
    )
    scans = load_verified_image2d_evidence(
        image2d_root, profile, backend.decode_jpeg
    )
    verify_source_snapshots(panoramas, scans)
    return panoramas, scans


def _crosswalk_for_matrix(
    derived: DerivedCrosswalk, size: int, digest: str
) -> dict[str, Any]:
    return build_crosswalk_manifest(
        derived.rows,
        derived.panoramas,
        derived.scans,
        derived.bindings,
        digest,
        size,
        derived.configuration,
        derived.generator,
        derived.dependency,
    )


def _dependency_attestation(
    backend: OpenCvSiftBackend, wheel_root: Path
) -> DependencyAttestation:
    if wheel_root.resolve(strict=True) != backend.dependency_wheel_root:
        raise ValueError("backend dependency wheel root differs from the requested run")
    backend.verify_dependency_bindings()
    _, attestation = verify_dependency_lock(
        LOCK_PATH,
        wheel_root,
        backend.dependency_versions,
        backend.runtime_file_paths,
        backend.runtime_controls,
        backend.distribution_roots,
    )
    backend.verify_dependency_bindings()
    if attestation != backend.initial_dependency_attestation:
        raise ValueError("dependency attestation changed after backend construction")
    return attestation


def _verify_run_provenance(
    backend: OpenCvSiftBackend,
    wheel_root: Path,
    repo_root: Path,
    reviewed_git_sha: str,
    basis_report: Path,
    generator: GeneratorBinding,
    dependency: DependencyAttestation,
    report_snapshot: Any,
) -> None:
    _verify_local_module_origins(repo_root)
    if capture_generator_binding(repo_root, reviewed_git_sha) != generator:
        raise ValueError("generator binding changed during the run")
    if verify_frozen_basis_report(basis_report) != report_snapshot:
        raise ValueError("frozen cubeface basis report changed during the run")
    if _dependency_attestation(backend, wheel_root) != dependency:
        raise ValueError("dependency attestation changed during the run")


def _protected_inputs(
    panorama_root: Path,
    panorama_manifest: Path,
    image2d_root: Path,
    wheel_root: Path,
    basis_report: Path,
    repo_root: Path,
) -> list[Path]:
    repo_files = [
        repo_root / Path(value)
        for value in (*GENERATOR_PATHS, DEPENDENCY_LOCK_RELATIVE_PATH)
    ]
    return [
        panorama_root,
        panorama_manifest.parent,
        image2d_root,
        wheel_root,
        basis_report.parent,
        basis_report,
        *repo_files,
    ]


def _verify_prepared_run(prepared: PreparedCrosswalkRun) -> None:
    derived = prepared.derived
    verify_final_input_custody(
        prepared.custody, derived.panoramas, derived.scans
    )
    _verify_run_provenance(
        prepared.backend,
        prepared.wheel_root,
        prepared.repo_root,
        prepared.reviewed_git_sha,
        prepared.basis_report,
        prepared.generator,
        prepared.dependency,
        prepared.report_snapshot,
    )


def _prepare_run(
    panorama_root: Path,
    panorama_manifest: Path,
    image2d_root: Path,
    output: Path,
    wheel_root: Path,
    reviewed_git_sha: str,
    basis_report: Path,
    repo_root: Path,
    profile: CrosswalkProfile,
    backend: OpenCvSiftBackend,
) -> PreparedCrosswalkRun:
    _verify_local_module_origins(repo_root)
    backend.verify_dependency_bindings()
    selected = backend
    generator = capture_generator_binding(repo_root, reviewed_git_sha)
    report_snapshot = verify_frozen_basis_report(basis_report)
    dependency = _dependency_attestation(selected, wheel_root)
    protected_output = assert_disjoint_output(
        output,
        _protected_inputs(
            panorama_root, panorama_manifest, image2d_root,
            wheel_root, basis_report, repo_root,
        ),
    )
    _require_safe_output(protected_output)
    custody = capture_input_custody(
        panorama_root, panorama_manifest, image2d_root
    )
    panoramas, scans = _load_sources(
        panorama_root, panorama_manifest, image2d_root, selected, profile
    )
    verify_input_custody(custody)
    derived = _derive_crosswalk(
        panoramas, scans, selected, profile, generator, dependency
    )
    prepared = PreparedCrosswalkRun(
        selected, protected_output, wheel_root, reviewed_git_sha,
        basis_report, repo_root, generator, dependency, report_snapshot,
        custody, derived,
    )
    _verify_prepared_run(prepared)
    return prepared


def run_build(
    panorama_root: Path,
    panorama_manifest: Path,
    image2d_root: Path,
    output: Path,
    wheel_root: Path,
    reviewed_git_sha: str,
    basis_report: Path,
    repo_root: Path = REPO_ROOT,
    profile: CrosswalkProfile = GRAND_HALL_CROSSWALK_PROFILE,
    backend: OpenCvSiftBackend | None = None,
) -> DerivedCrosswalk:
    manager = (
        OpenCvSiftBackend(wheel_root) if backend is None else nullcontext(backend)
    )
    with manager as selected:
        prepared = _prepare_run(
            panorama_root, panorama_manifest, image2d_root, output, wheel_root,
            reviewed_git_sha, basis_report, repo_root, profile, selected,
        )
        derived = prepared.derived
        publish_crosswalk_pack(
            prepared.output,
            derived.matrix,
            lambda size, digest: _crosswalk_for_matrix(derived, size, digest),
            derived.bindings,
            derived.configuration,
            prepared.generator,
            prepared.dependency,
        )
        _verify_prepared_run(prepared)
        return derived


def run_check(
    panorama_root: Path,
    panorama_manifest: Path,
    image2d_root: Path,
    output: Path,
    wheel_root: Path,
    reviewed_git_sha: str,
    basis_report: Path,
    repo_root: Path = REPO_ROOT,
    profile: CrosswalkProfile = GRAND_HALL_CROSSWALK_PROFILE,
    backend: OpenCvSiftBackend | None = None,
) -> DerivedCrosswalk:
    manager = (
        OpenCvSiftBackend(wheel_root) if backend is None else nullcontext(backend)
    )
    with manager as selected:
        prepared = _prepare_run(
            panorama_root, panorama_manifest, image2d_root, output, wheel_root,
            reviewed_git_sha, basis_report, repo_root, profile, selected,
        )
        derived = prepared.derived
        matrix_bytes = canonical_json_bytes(derived.matrix)
        crosswalk = _crosswalk_for_matrix(
            derived, len(matrix_bytes), sha256_bytes(matrix_bytes)
        )
        verify_crosswalk_pack(
            prepared.output,
            derived.matrix,
            crosswalk,
            derived.bindings,
            derived.configuration,
            prepared.generator,
            prepared.dependency,
        )
        _verify_prepared_run(prepared)
        return derived


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build or check an authority-none panorama/Image2D candidate crosswalk."
    )
    parser.add_argument("--panorama-root", required=True)
    parser.add_argument("--panorama-manifest", required=True)
    parser.add_argument("--image2d-evidence-root", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--dependency-wheel-root", required=True)
    parser.add_argument("--reviewed-git-sha", required=True)
    parser.add_argument("--cube-basis-report", required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--verify-source-hashes", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if not args.verify_source_hashes:
        parser.error("--verify-source-hashes is mandatory for build and check mode")
    operation = run_check if args.check else run_build
    wheel_root = Path(args.dependency_wheel_root)
    with OpenCvSiftBackend(wheel_root) as backend:
        derived = operation(
            Path(args.panorama_root),
            Path(args.panorama_manifest),
            Path(args.image2d_evidence_root),
            Path(args.out),
            wheel_root,
            args.reviewed_git_sha,
            Path(args.cube_basis_report),
            backend=backend,
        )
    print(
        f"Authority-none crosswalk verified: {len(derived.panoramas)} panoramas x "
        f"{len(derived.scans)} Data3D identities."
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"Panorama/Image2D crosswalk failed: {error}", file=sys.stderr)
        sys.exit(1)
