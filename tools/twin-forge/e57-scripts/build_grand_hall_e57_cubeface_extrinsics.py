"""Build/check a frozen, authority-none Grand Hall E57 cubeface solve.

Only Data3D headers, scanner-local coloured points, and the already extracted
T559 JPEG bytes reach the solver.  Stored Image2D poses are neither read nor
represented at the solver boundary.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
from typing import Callable, Iterator, Mapping, Protocol, Sequence

import numpy as np
from numpy.typing import NDArray

# ``-I`` deliberately omits the script directory.  Add only the directory of
# this reviewed entry point so its sibling modules can be imported; their exact
# origins and Git blobs are rechecked before a solve can publish.
SCRIPT_DIRECTORY = Path(__file__).resolve(strict=True).parent
if str(SCRIPT_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIRECTORY))

from e57_image2d_evidence import canonical_json_bytes, publication_stage
from e57_stage_guard import assert_disjoint_output, load_stage
from grand_hall_e57_cubeface_extrinsics import (
    BASIS_BY_ID,
    CANONICAL_FACE_BASIS_IDS,
    SIGNED_AXIS_BASES,
    BasisScore,
    basis_score_json,
    CameraIntrinsics,
    RESULT_SCHEMA,
    ScoringThresholds,
    compose_camera_extrinsics,
    deterministic_scanner_sample,
    face_solve_json,
    quaternion_wxyz_to_rotation,
    solve_face,
    thresholds_json,
    validate_cube_solution,
    _require_face_gates,
    _score_sort_key,
)


RESULT_NAME = "cubeface-extrinsics-authority-none.json"
RECEIPT_NAME = "publication-receipt.json"
RECEIPT_SCHEMA = "venviewer.e57-cubeface-extrinsics-publication-authority-none.v1"
DEPENDENCY_CONTRACT_SCHEMA = (
    "venviewer.e57-cubeface-extrinsics-dependency-bootstrap-authority-none.v1"
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
EXPECTED_SCANS = tuple(range(40, 48))
EXPECTED_FIELDS = {
    "cartesianX",
    "cartesianY",
    "cartesianZ",
    "cartesianInvalidState",
    "rowIndex",
    "columnIndex",
    "colorRed",
    "colorGreen",
    "colorBlue",
}
EXPECTED_POINT_COUNT = 6_480_000
MINIMUM_VALID_POINT_COUNT = 5_000_000
MAXIMUM_AABB_DELTA_M = 0.03
SAMPLE_MODULUS = 8
MINIMUM_RANGE_M = 0.0
FROZEN_STAGE_MANIFEST = (50_122, "c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff")
FROZEN_STAGE_PLAN_SHA256 = "d9a75df3ffaf2706d97f454cbfae9a5c47ce0719c83af7f56da391ce0def3729"
FROZEN_E57 = (20_518_437_888, "975039d11fc04ca681f038e499f358124bbcab178ad5ce6324fa912212729cdd")
FROZEN_T559_MANIFEST = (663_151, "fd13da9638d1a1e194fb0c1acaedbe07dea15e65d9c16353d29f6542ce3ad344")
FROZEN_T559_RECEIPT = (600, "a19b4058ab6006744184101d0b8287f14a64390065743dc5ff63fb73fa882415")
FROZEN_T560_MATRIX = (4_773_324, "7fc8c34eefda10890e462180fb59c9ffb8c9d7a4bfe56afdee5c1752c8b3bc36")
FROZEN_T560_CROSSWALK = (2_025_532, "3b0a7757395904233e5fa1436dfe68c0a0daa9539c48ef079f70dde528c82215")
FROZEN_T560_RECEIPT = (3_222, "219d5c79512844d3c078871433010447052e7f5e770d74a0da3acf714f62153d")
FROZEN_CAMERA_SUBSET = (46_000, "4498873b37d112486609b2174f03c2cd1832ac9d7ead33d502653a3a15c52b98")
INTRINSICS = CameraIntrinsics()
THRESHOLDS = ScoringThresholds()
EXPECTED_DISTRIBUTIONS = {
    "numpy": (
        "1.26.4",
        "08beddf13648eb95f8d867350f6a018a4be2e5ad54c8d8caed89ebca558b2818",
    ),
    "opencv-python-headless": (
        "4.10.0.84",
        "afcf28bd1209dd58810d33defb622b325d3cbe49dcd7a43a902982c33e5fad05",
    ),
    "pye57": (
        "0.4.19",
        "ec415dac94f66832d8f8709ef33eb43b1a5a002ac63c02af5458229c8d29e3a2",
    ),
    "pyquaternion": (
        "0.9.9",
        "e65f6e3f7b1fdf1a9e23f82434334a1ae84f14223eee835190cd2e841f8172ec",
    ),
}
REQUIRED_NATIVE_PATHS = (
    "Lib/site-packages/cv2/cv2.pyd",
    "Lib/site-packages/numpy/core/_multiarray_umath.cp312-win_amd64.pyd",
    "Lib/site-packages/numpy/linalg/_umath_linalg.cp312-win_amd64.pyd",
    (
        "Lib/site-packages/numpy.libs/"
        "libopenblas64__v0.3.23-293-gc2f4bdbb-gcc_10_3_0-"
        "2bde3a66a51006b2b53eb373ff767a3f.dll"
    ),
    "Lib/site-packages/pye57/libe57.cp312-win_amd64.pyd",
    "Lib/site-packages/pye57/xerces-c_3_2.dll",
)
TRUTH_SCOPE = "internal consistency of same-capture E57 coloured points and T559 JPEGs only"
GENERATOR_RELATIVE_PATHS = (
    "tools/twin-forge/e57-scripts/grand_hall_e57_cubeface_extrinsics.py",
    "tools/twin-forge/e57-scripts/build_grand_hall_e57_cubeface_extrinsics.py",
    "tools/twin-forge/e57-scripts/e57-cubeface-extrinsics-dependency-bootstrap-authority-none.json",
    "tools/twin-forge/e57-scripts/requirements-panorama-image2d-crosswalk.lock.json",
    "tools/twin-forge/e57-scripts/e57_stage_guard.py",
    "tools/twin-forge/e57-scripts/e57_image2d_evidence.py",
)
FROZEN_SCAN_GUIDS = (
    "358291034cad4ed6a2774ea12c6cb4c7",
    "7906a35c0ddc422fa3fa5fa2944c3367",
    "98dacd61bf414e09aa92e703b8c18c3b",
    "7f61dcb781a14dfda07adfa7b9a324d5",
    "0cbaccbbeed34aaf8790e71d5393cb3e",
    "e8fbbc0cb4a243278573a14ed341e13f",
    "2d837563cd3d4963a3456805b333942e",
    "5ba1879351274fd9ad1759f7a9394dff",
)
CAMERA_CENTER_DIAGNOSTIC_REASON = (
    "Image2D pixels and coloured points share capture lineage; no independent "
    "observation supports a metric center-offset fit."
)
FROZEN_CANDIDATE_ROWS = (
    (
        (0.6956759691238403, -0.00411228695884347, -0.004772225860506296, -0.7183281779289246),
        (-0.19139546155929565, -9.471705436706543, 1.4969134330749512),
        41,
        1,
        None,
    ),
    (
        (0.6920840740203857, 0.0072634778916835785, 0.009907020255923271, -0.7217124104499817),
        (13.690361976623535, -9.582846641540527, 1.4926996231079102),
        42,
        1,
        None,
    ),
    (
        (0.7110180854797363, 0.0030353721231222153, 0.007122716400772333, -0.7031311392784119),
        (17.721010208129883, -9.611360549926758, 1.4586478471755981),
        43,
        1,
        None,
    ),
    (
        (-0.033488139510154724, -0.006283272989094257, -0.008484392426908016, 0.9993833899497986),
        (8.884137153625488, -4.93303108215332, 1.5365030765533447),
        44,
        1,
        None,
    ),
    (
        (0.059076663106679916, -0.014020128175616264, -0.01195539440959692, 0.9980834722518921),
        (-0.24381932616233826, -4.904568672180176, 1.4919763803482056),
        45,
        1,
        None,
    ),
    (
        (0.6423422694206238, -0.013078566640615463, -0.0005647795624099672, 0.7663061618804932),
        (2.5859878063201904, -1.0720375776290894, 1.5149927139282227),
        46,
        1,
        None,
    ),
    (
        (0.9999203681945801, -0.008575893007218838, 0.0027582680340856314, 0.008837739005684853),
        (5.600035190582275, -3.8226101398468018, 1.5369462966918945),
        47,
        2,
        "two_matcher_supported_candidates_human_review_required",
    ),
    (
        (-0.012043189257383347, -0.0020717885345220566, 0.002109530149027705, 0.9999231696128845),
        (11.172720909118652, -5.179567337036133, 1.5343906879425049),
        48,
        1,
        None,
    ),
)
FROZEN_SELECTED_T559_FILES = (
    (3799135, "db9664529f4129917c7c86af7a53429ac8acfc255d387c2448ceed6cea97af46"),
    (3095857, "421a13627ab900fbc258a4d25cacd368085c57ba482870394638ea8e12f6f3c0"),
    (3579708, "5ad544509a5b2c220364fa0ee7d27ef12f16805d62b3cc5f170ec5449aad6755"),
    (4100234, "b4039bacd67b3b5d8ee1ac164a40911ee78da34242e5d9ff41161bdab68e9e00"),
    (4150479, "cf698cced95df21d2879610ba6f64b43f4010978826ebe6e11fdb27c3b86965d"),
    (3653516, "05481beb2d157bd0f94bfcb156f468735a50c024296bc8bd9c04fbcfc522b4e0"),
    (3416576, "0202692caa070915662e34081101ce95760d76cd1fc8b26717928029fd58bfc4"),
    (3307824, "e48bf4257c7c89771885c3f410c16572bf01a3cafa10c9d353dd0c57254b5ddf"),
    (4199597, "8bac3dd325b89a8d39f5e4b580ac0544e3f125eb975398bfd830270baa2c0983"),
    (3814860, "a018bb037025e1e739daf8de2a4679d021f8c74c064d20145ae53d6c64da72df"),
    (4131696, "6b0787e492cb6b4f7c177177fe304b445f75f2fce42d74cd7bd0ed36027bc203"),
    (3967839, "f2576b4cabe82c7e9b310e13522e43adb4a11645228a41d753409b1837b57ce2"),
    (3677318, "607e72b84be15f6c7fe785d1e0d482663f85ef052974145663bcc47d1a6c4fc6"),
    (3076225, "b13f6b5d50269190fc9c94252bdf3e47823eb277249a25e0f7f47a7e848eb2fa"),
    (4090096, "2ed1481e95dbbcf6b6fe95dab3d704f1d8efb370c82de2d20dff99dc21b6977a"),
    (4156935, "b674d35cc62bb017c3f78bae615ba086b2599e55bb9c82c7771b721eb73694ae"),
    (3529597, "d918805f1f344565944d5f9707090f589972389231946f12ab0ad4b0e2146f4b"),
    (3837359, "1a54a731d42a42068310547ded976c288622d3b98ad3a3c5bc9f653bde06254f"),
    (3936865, "4c1a7550a6547bffcc18c371cfc5f6ffd76d454d3b9780f253aa820e41ec4c72"),
    (4185918, "fecfaaee7ac99cdfa2fe4d706dd890d4d20ac08c93b6b79afb80afcb85830d03"),
    (3763499, "a56cf5983f70a0bbb3da9db81c5bc578fbc8c9214d21e778b15cebcf8651a239"),
    (4381301, "fa921e7cb33e9ff1fc0338cf33c545a427db23f2bdbd406dada74bbc88e62e52"),
    (4120255, "c1e9f40c02d1881b5c46df1d2d8e4c7355862875102a0049047936bb9ff6aa87"),
    (3762844, "bd79ebc17180e2d2a22bf4d8f5ec6a8b43e90858819ad0185a581ad03291394c"),
    (3857281, "5f342e1d351f6be552ffcadc2e0b5e87741ef23ff24ff4530408822a6229382c"),
    (3670265, "1b86fadbd2c3a04e909fe1e6ede9dfc1073352f50b676527c9ea9f09d423b155"),
    (3759753, "59c211545aa805a190d780645c7ac3c3521d70c935a7c9df6c17eb9926c7cbbd"),
    (4576434, "81e4f0f02698ab8665b0dd2c1e943b54da57a025e2be69d63031634c00babf65"),
    (4187390, "357b2161e277491dbf9e125fdf43360ef738f1539c77141427620a01d089099b"),
    (4043887, "11973a0428471ac8579818de30efddfe441bcc3ad088a35d205ba9ceae29af4d"),
    (3710578, "0204eda7ab6921348d024965f15b5b44cc8e29c3170f2cfb5a267dd80bdd29a9"),
    (3523267, "b636f03f767fa042aa01da29ff9f84394da98142a8aa691c7a3e04edf58cc286"),
    (4655842, "3f7877aff76f07227893e8cef85c73de864c5e55a2f1a0e5f77b5531e55261cf"),
    (4196551, "4e7e66b95ff0729876372ca8ee9d73ced8a699748a82cd2f5acc414a261f5f15"),
    (4127702, "82d71b7202fc75570ca21ba2b6e1631158646fb6fcf57b83fb7c7d10c86df072"),
    (4538239, "27b96dbdb36e98f11fb8952c66b718cb74f1c2920931d9eb9d19761ac6a08f9c"),
    (3975091, "b00f5de81935988cae7067bec3a69dd4b98d911084fb67d2f697950babcd198f"),
    (4183466, "6e16585c25f7ad9d31ee1955c493d473df4dc5969e1540e2effc392cf788dbd2"),
    (3940480, "fd1f2b6534f7ebb633cf907c215009ee987b88688edb6b6f8e30da87feb6e14a"),
    (4116183, "c06ef76e394616f7e07d84309c22d36cc01211336a3053d64341e39951340fca"),
    (3836266, "a6e8a757a90951210ab51e54ea3e2c0f47ab4f960981e45c37af4d2d5ab58614"),
    (4242774, "df2521f1eb94ec72c3766964741d3b1aeafbab4d8595cfc2a44977439fc74a55"),
    (4080100, "add2645a2196152f661b031844d10670c5a1c971934a24a2f75dc79f4e927fd4"),
    (4182498, "ab24c2eda44616f674e15cb74fc267d32ee199f2359f140e8836c661c15a8665"),
    (3732845, "e9a220b28c572081017a955105a14a2252a62f15eacc7bba01627b7bf75caf60"),
    (4493665, "3837ed767f981bd3fa4000c64a084ae58d831cf35361f04eb67e6c404991bb29"),
    (4150176, "f200d23eddab49140c9bfeb26c39555c8c74c2343dce674d6684199a885c8115"),
    (4379012, "92462fdfd206c62315494b77f7c64cd0c7f037852521a4c08af6aaa162046546"),
)
FROZEN_RUNTIME_ROOT = Path("D:/venviewer-tools/t564-e57-cubeface-hermetic-py312-v1")
FROZEN_RUNTIME_TREE = (
    930,
    "02892b5dcecea27f224c95042d148d69ae7411f170ba02ef0e0c12d6c7c856d7",
)
FROZEN_PYTHON_EXECUTABLE = (
    262_144,
    "711df14e4ef9f0890c5c84330faba821839f3f6757dbe27cbf69ac3de6852446",
)
FROZEN_PYE57_NATIVE_FILES = (
    {
        "relativePath": "libe57.cp312-win_amd64.pyd",
        "sha256": "bd3a02bc33df26b56fc8dbbffb3fe018a1c3de4bf715cfe95a4ed311c5e07b98",
        "sizeBytes": 781_824,
    },
    {
        "relativePath": "xerces-c_3_2.dll",
        "sha256": "7af1375b748ed58b8d5ff316a11fac6f4ec2742e572a099bf891523ceb5d5134",
        "sizeBytes": 2_793_984,
    },
)


@dataclass(frozen=True)
class FileSnapshot:
    device: int
    inode: int
    mode: int
    size_bytes: int
    modified_ns: int
    changed_ns: int
    link_count: int


@dataclass(frozen=True)
class DirectorySnapshot:
    device: int
    inode: int
    mode: int


@dataclass(frozen=True)
class BoundFile:
    label: str
    path: Path
    relative_path: str
    size_bytes: int
    sha256: str
    snapshot: FileSnapshot


@dataclass(frozen=True)
class CubefaceSource:
    scan_index: int
    face_index: int
    image_index: int
    data3d_guid: str
    path: Path
    relative_path: str
    size_bytes: int
    sha256: str
    snapshot: FileSnapshot


@dataclass(frozen=True)
class CandidateRow:
    scan_index: int
    data3d_guid: str
    sweep_number: int
    quaternion_wxyz: tuple[float, float, float, float]
    translation_m: tuple[float, float, float]
    cubefaces: tuple[CubefaceSource, ...]
    crosswalk_supported_candidate_count: int
    crosswalk_caveat: str | None


@dataclass(frozen=True)
class FrozenInputs:
    stage_root: Path
    image2d_root: Path
    crosswalk_root: Path
    camera_subset: Path


@dataclass(frozen=True)
class PreparedInputs:
    source_files: tuple[BoundFile, ...]
    stage_manifest: BoundFile
    e57: BoundFile
    t559_manifest: BoundFile
    t559_receipt: BoundFile
    t560_matrix: BoundFile
    t560_crosswalk: BoundFile
    t560_receipt: BoundFile
    camera_subset: BoundFile
    rows: tuple[CandidateRow, ...]


@dataclass(frozen=True)
class RuntimeActivation:
    contract_sha256: str
    runtime_tree_sha256: str
    runtime_tree_file_count: int


@dataclass(frozen=True)
class ScanHeader:
    guid: str
    rotation_wxyz: tuple[float, float, float, float]
    translation_m: tuple[float, float, float]
    point_count: int
    point_fields: frozenset[str]
    bounds: tuple[float, float, float, float, float, float]


class CaptureReader(Protocol):
    def scan_count(self) -> int: ...
    def header(self, scan_index: int) -> ScanHeader: ...
    def read_scan_raw(self, scan_index: int) -> Mapping[str, NDArray[np.generic]]: ...
    def close(self) -> None: ...


RaceHook = Callable[[str, Path], None]


def _noop_hook(_event: str, _path: Path) -> None:
    return


def _reject_constant(value: str) -> None:
    raise ValueError(f"JSON contains forbidden non-finite constant {value!r}")


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"JSON contains duplicate key {key!r}")
        result[key] = value
    return result


def load_strict_json(content: bytes, label: str) -> dict[str, object]:
    try:
        decoded = content.decode("utf-8")
        value = json.loads(
            decoded,
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is not strict UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must contain a JSON object")
    return value


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _is_link_or_reparse(path: Path) -> bool:
    metadata = path.lstat()
    attributes = getattr(metadata, "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    return path.is_symlink() or bool(reparse_flag and attributes & reparse_flag)


def _snapshot(path: Path, *, require_single_link: bool = True) -> FileSnapshot:
    if _is_link_or_reparse(path):
        raise ValueError(f"evidence path is a link or reparse point: {path}")
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode):
        raise ValueError(f"evidence path is not a regular file: {path}")
    if require_single_link and metadata.st_nlink != 1:
        raise ValueError(f"evidence path has multiple hard links: {path}")
    return FileSnapshot(
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
        metadata.st_nlink,
    )


def _directory_snapshot(path: Path) -> DirectorySnapshot:
    if _is_link_or_reparse(path):
        raise ValueError(f"evidence directory is a link or reparse point: {path}")
    metadata = path.lstat()
    if not stat.S_ISDIR(metadata.st_mode):
        raise ValueError(f"evidence directory is not a directory: {path}")
    return DirectorySnapshot(
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
    )


def _same_open_file(actual: os.stat_result, expected: FileSnapshot) -> bool:
    # On Windows, CRT ``fstat`` synthesises permission bits for an already-open
    # handle and can report (for example) 0o666 where ``lstat`` reported 0o777
    # for the same executable.  File type, path-side metadata, and identity are
    # still checked; comparing those synthetic permission bits would reject a
    # stable executable such as Scripts/f2py.exe.
    mode_matches = (
        stat.S_ISREG(actual.st_mode) and stat.S_ISREG(expected.mode)
        if os.name == "nt"
        else actual.st_mode == expected.mode
    )
    return (
        actual.st_dev,
        actual.st_ino,
        actual.st_size,
        actual.st_mtime_ns,
        actual.st_nlink,
    ) == (
        expected.device,
        expected.inode,
        expected.size_bytes,
        expected.modified_ns,
        expected.link_count,
    ) and mode_matches


def _read_stable(path: Path, expected: FileSnapshot) -> bytes:
    if _snapshot(path) != expected:
        raise ValueError(f"evidence path changed before read: {path}")
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        content = stream.read()
        after = os.fstat(stream.fileno())
    if not _same_open_file(before, expected) or not _same_open_file(after, expected):
        raise ValueError(f"opened evidence identity changed during read: {path}")
    if _snapshot(path) != expected:
        raise ValueError(f"evidence path changed during read: {path}")
    return content


@contextmanager
def windows_read_leases(paths: Sequence[Path]) -> Iterator[None]:
    """Deny writes and deletes while allowing independent read handles."""
    if os.name != "nt":
        raise ValueError("strict evidence custody requires Windows sharing-deny leases")
    import ctypes
    from ctypes import wintypes

    create_file = ctypes.WinDLL("kernel32", use_last_error=True).CreateFileW
    create_file.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    create_file.restype = wintypes.HANDLE
    close_handle = ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    generic_read = 0x80000000
    share_read = 0x00000001
    open_existing = 3
    normal = 0x00000080
    invalid = wintypes.HANDLE(-1).value
    handles: list[int] = []
    unique = sorted({path.resolve(strict=True) for path in paths}, key=lambda value: os.path.normcase(str(value)))
    try:
        for path in unique:
            handle = create_file(str(path), generic_read, share_read, None, open_existing, normal, None)
            if handle == invalid:
                raise ctypes.WinError(ctypes.get_last_error())
            handles.append(handle)
        yield
    finally:
        for handle in reversed(handles):
            close_handle(handle)


@contextmanager
def windows_directory_identity_lease(path: Path) -> Iterator[DirectorySnapshot]:
    """Pin one direct directory identity while allowing child create/write operations."""
    if os.name != "nt":
        raise ValueError("strict directory custody requires Windows sharing semantics")
    import ctypes
    from ctypes import wintypes

    resolved = _verify_path_chain(path, "leased directory", must_exist=True)
    before = _directory_snapshot(resolved)
    create_file = ctypes.WinDLL("kernel32", use_last_error=True).CreateFileW
    create_file.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    create_file.restype = wintypes.HANDLE
    close_handle = ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    generic_read = 0x80000000
    share_read_write = 0x00000001 | 0x00000002
    open_existing = 3
    backup_semantics = 0x02000000
    invalid = wintypes.HANDLE(-1).value
    handle = create_file(
        str(resolved),
        generic_read,
        share_read_write,
        None,
        open_existing,
        backup_semantics,
        None,
    )
    if handle == invalid:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if _directory_snapshot(resolved) != before:
            raise ValueError("leased directory identity changed while its handle opened")
        yield before
        if _directory_snapshot(resolved) != before:
            raise ValueError("leased directory identity changed while custody was held")
    finally:
        close_handle(handle)


def _verify_path_chain(path: Path, label: str, *, must_exist: bool) -> Path:
    if not path.is_absolute() or len(path.drive) != 2 or path.drive[1] != ":":
        raise ValueError(f"{label} must use an absolute ordinary local drive-letter path")
    raw = str(path)
    if raw.startswith("\\\\") or raw.startswith("\\\\?\\") or raw.startswith("\\\\.\\"):
        raise ValueError(f"{label} cannot use UNC or device syntax")
    if any(":" in part for part in path.parts[1:]):
        raise ValueError(f"{label} cannot contain an alternate data stream")
    absolute = path.absolute()
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if not os.path.lexists(current):
            if must_exist:
                raise ValueError(f"{label} is absent: {current}")
            break
        if _is_link_or_reparse(current):
            raise ValueError(f"{label} traverses a link or reparse point: {current}")
    if must_exist:
        resolved = absolute.resolve(strict=True)
        if os.path.normcase(str(resolved)) != os.path.normcase(str(absolute)):
            raise ValueError(f"{label} is not a canonical direct path")
        return resolved
    return absolute.resolve(strict=False)


def _bind_exact(path: Path, label: str, expected: tuple[int, str], relative: str) -> tuple[BoundFile, bytes]:
    resolved = _verify_path_chain(path, label, must_exist=True)
    snapshot = _snapshot(resolved)
    if snapshot.size_bytes != expected[0]:
        raise ValueError(f"{label} byte count differs from the frozen identity")
    content = _read_stable(resolved, snapshot)
    digest = sha256_bytes(content)
    if digest != expected[1]:
        raise ValueError(f"{label} SHA-256 differs from the frozen identity")
    return BoundFile(label, resolved, relative, len(content), digest, snapshot), content


def _dict(value: object, label: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _require_exact_keys(
    value: dict[str, object], expected: set[str], label: str
) -> None:
    if set(value) != expected:
        raise ValueError(
            f"{label} keys drifted; missing={sorted(expected - set(value))}, "
            f"unexpected={sorted(set(value) - expected)}"
        )


def _list(value: object, label: str) -> list[object]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    return value


def _string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _integer(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{label} must be an integer")
    return value


def _finite_tuple(value: object, length: int, label: str) -> tuple[float, ...]:
    items = _list(value, label)
    if len(items) != length:
        raise ValueError(f"{label} must contain {length} values")
    result: list[float] = []
    for item in items:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)):
            raise ValueError(f"{label} values must be finite numbers")
        result.append(float(item))
    return tuple(result)


def _relative_file(root: Path, value: object, label: str) -> Path:
    relative = _string(value, label)
    if "\\" in relative:
        raise ValueError(f"{label} must use POSIX separators")
    pure = PurePosixPath(relative)
    if pure.is_absolute() or not pure.parts or any(part in ("", ".", "..") for part in pure.parts):
        raise ValueError(f"{label} is not a canonical relative path")
    candidate = root.joinpath(*pure.parts)
    resolved = _verify_path_chain(candidate, label, must_exist=True)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError(f"{label} escapes its evidence root") from error
    return resolved


def _verify_all_guards_false(value: object, label: str) -> None:
    guards = _dict(value, label)
    if guards.get("authority") != "none":
        raise ValueError(f"{label} authority must remain none")
    for key, item in guards.items():
        if key == "authority":
            continue
        if item is not False:
            raise ValueError(f"{label}.{key} must remain false")


def _selected_rows(
    subset: dict[str, object],
    image_manifest: dict[str, object],
    image_root: Path,
    crosswalk: dict[str, object],
) -> tuple[CandidateRow, ...]:
    if (
        subset.get("schemaVersion")
        != "venviewer.grand-hall.camera-metric-subset.v1"
        or subset.get("authority") != "none"
    ):
        raise ValueError("camera subset schema or authority drifted")
    _verify_all_guards_false(subset.get("contract"), "camera subset contract")
    rows_raw = _list(subset.get("rows"), "camera subset rows")
    if len(rows_raw) != 8:
        raise ValueError("camera subset must bind exactly eight candidate rows")
    images = [_dict(value, "T559 image record") for value in _list(image_manifest.get("images"), "T559 images")]
    data3d = [_dict(value, "T559 Data3D record") for value in _list(image_manifest.get("data3D"), "T559 data3D")]
    if len(data3d) != 149 or len(images) != 894:
        raise ValueError("T559 inventory cardinality drifted")
    image_by_index = {_integer(item.get("imageIndex"), "T559 image index"): item for item in images}
    if len(image_by_index) != len(images):
        raise ValueError("T559 image indices are duplicated")
    crosswalk_rows = [_dict(value, "T560 row") for value in _list(crosswalk.get("results"), "T560 results")]
    crosswalk_by_sweep: dict[int, dict[str, object]] = {}
    for value in crosswalk_rows:
        display = _dict(value.get("display"), "T560 display")
        sweep = _integer(display.get("sweepNumber"), "T560 sweep number")
        if sweep in crosswalk_by_sweep:
            raise ValueError("T560 duplicates a sweep number")
        crosswalk_by_sweep[sweep] = value
    result: list[CandidateRow] = []
    for expected_scan, raw in zip(EXPECTED_SCANS, rows_raw):
        row = _dict(raw, "camera subset row")
        if row.get("authority") != "none":
            raise ValueError("camera subset row authority drifted")
        _verify_all_guards_false(row.get("guards"), "camera subset guards")
        scanner = _dict(row.get("e57Scanner"), "camera subset E57 scanner")
        scan_index = _integer(scanner.get("scanIndex"), "camera subset scan index")
        guid = _string(scanner.get("data3DGuid"), "camera subset Data3D GUID")
        if scan_index != expected_scan:
            raise ValueError("camera subset scan order or candidate universe drifted")
        if scan_index >= len(data3d) or data3d[scan_index] != {"guid": guid, "scanIndex": scan_index}:
            raise ValueError("camera subset Data3D identity differs from T559")
        if scanner.get("poseAuthority") != "none" or scanner.get("orientationUseBlocked") is not True:
            raise ValueError("camera subset pose must remain authority-none and orientation-blocked")
        quaternion = _finite_tuple(scanner.get("rotationQuaternionWxyz"), 4, "camera subset quaternion")
        translation = _finite_tuple(scanner.get("translationM"), 3, "camera subset translation")
        panorama = _dict(row.get("externalPanorama"), "camera subset panorama")
        sweep = _integer(panorama.get("sweepNumber"), "camera subset sweep number")
        if (
            sweep != scan_index + 1
            or panorama.get("poseAuthority") != "none"
            or panorama.get("orientationAuthority") != "none"
        ):
            raise ValueError("camera subset sweep or panorama authority drifted")
        candidate = _dict(row.get("candidateCorrespondence"), "camera subset correspondence")
        if candidate.get("humanReviewRequired") is not True or candidate.get("state") != "candidate_human_pending":
            raise ValueError("camera subset correspondence must remain human-pending")
        count = _integer(candidate.get("supportedCandidateCount"), "supported candidate count")
        caveat_value = candidate.get("caveat")
        caveat = None if caveat_value is None else _string(caveat_value, "correspondence caveat")
        crosswalk_row = crosswalk_by_sweep.get(sweep)
        if crosswalk_row is None or crosswalk_row.get("humanReviewRequired") is not True:
            raise ValueError("T560 does not bind the candidate sweep as human-pending")
        supported = [
            item
            for item in (
                _dict(value, "T560 candidate")
                for value in _list(crosswalk_row.get("candidates"), "T560 candidates")
            )
            if item.get("supported") is True
        ]
        supported_guids = {_string(item.get("data3DGuid"), "T560 candidate GUID") for item in supported}
        if guid not in supported_guids or len(supported_guids) != count:
            raise ValueError("T560 supported candidate set differs from the frozen subset")
        faces_raw = [
            _dict(value, "camera subset cubeface")
            for value in _list(row.get("nativeCubefaces"), "native cubefaces")
        ]
        if len(faces_raw) != 6:
            raise ValueError("camera subset row must contain exactly six cubefaces")
        faces: list[CubefaceSource] = []
        for face_index, face in enumerate(faces_raw):
            image_index = _integer(face.get("imageIndex"), "cubeface image index")
            if face.get("faceIndex") != face_index or image_index != scan_index * 6 + face_index:
                raise ValueError("cubeface native ordering drifted")
            record = image_by_index.get(image_index)
            if record is None:
                raise ValueError("cubeface is absent from T559")
            relative = _string(face.get("relativePath"), "cubeface relative path")
            digest = _string(face.get("sha256"), "cubeface digest")
            if digest.startswith("sha256:"):
                digest = digest[7:]
            if SHA256_RE.fullmatch(digest) is None:
                raise ValueError("cubeface digest is not a lowercase SHA-256")
            expected_record = {
                "associatedData3DGuid": guid,
                "blob": "jpegImage",
                "data3DIndex": scan_index,
                "decodedMode": "RGB",
                "faceIndex": face_index,
                "focalLength": 0.5,
                "height": 4096,
                "imageGuid": face.get("imageGuid"),
                "imageIndex": image_index,
                "imageName": f"Skybox {face_index}",
                "pixelHeight": 0.000244140625,
                "pixelWidth": 0.000244140625,
                "principalPointX": 2048.0,
                "principalPointY": 2048.0,
                "relativePath": relative,
                "representation": "pinholeRepresentation",
                "sha256": digest,
                "sizeBytes": face.get("byteLength"),
                "width": 4096,
            }
            if record != expected_record:
                raise ValueError("camera subset cubeface differs from the exact T559 record")
            path = _relative_file(image_root, relative, "T559 cubeface")
            snapshot = _snapshot(path)
            size = _integer(face.get("byteLength"), "cubeface byte length")
            if snapshot.size_bytes != size:
                raise ValueError("cubeface byte count drifted")
            faces.append(
                CubefaceSource(
                    scan_index,
                    face_index,
                    image_index,
                    guid,
                    path,
                    relative,
                    size,
                    digest,
                    snapshot,
                )
            )
        result.append(
            CandidateRow(
                scan_index,
                guid,
                sweep,
                (quaternion[0], quaternion[1], quaternion[2], quaternion[3]),
                (translation[0], translation[1], translation[2]),
                tuple(faces),
                count,
                caveat,
            )
        )
    return tuple(result)


def prepare_inputs(inputs: FrozenInputs) -> PreparedInputs:
    stage_root = _verify_path_chain(inputs.stage_root, "capture stage", must_exist=True)
    image_root = _verify_path_chain(inputs.image2d_root, "T559 root", must_exist=True)
    crosswalk_root = _verify_path_chain(inputs.crosswalk_root, "T560 root", must_exist=True)
    subset_path = _verify_path_chain(inputs.camera_subset, "camera subset", must_exist=True)
    if not stage_root.is_dir() or not image_root.is_dir() or not crosswalk_root.is_dir():
        raise ValueError("frozen evidence roots must be real directories")
    stage_manifest, stage_bytes = _bind_exact(
        stage_root / "capture-stage-manifest.json",
        "stage manifest",
        FROZEN_STAGE_MANIFEST,
        "capture-stage-manifest.json",
    )
    stage_value = load_strict_json(stage_bytes, "stage manifest")
    if stage_value.get("planSha256") != FROZEN_STAGE_PLAN_SHA256:
        raise ValueError("capture stage plan digest drifted")
    stage = load_stage(stage_root)
    if (
        stage.plan_sha256 != FROZEN_STAGE_PLAN_SHA256
        or stage.primary_e57.size_bytes != FROZEN_E57[0]
        or stage.primary_e57.sha256 != FROZEN_E57[1]
    ):
        raise ValueError("capture stage primary E57 binding drifted")
    e57_path = _verify_path_chain(stage.primary_e57.path, "staged E57", must_exist=True)
    e57_snapshot = _snapshot(e57_path)
    if e57_snapshot.size_bytes != FROZEN_E57[0]:
        raise ValueError("staged E57 byte count drifted")
    e57 = BoundFile(
        "staged E57",
        e57_path,
        stage.primary_e57.target_relative_path,
        FROZEN_E57[0],
        FROZEN_E57[1],
        e57_snapshot,
    )
    t559_manifest, t559_bytes = _bind_exact(
        image_root / "image2d-inventory-authority-none.json",
        "T559 manifest",
        FROZEN_T559_MANIFEST,
        "image2d-inventory-authority-none.json",
    )
    t559_receipt, t559_receipt_bytes = _bind_exact(
        image_root / "publication-receipt.json",
        "T559 receipt",
        FROZEN_T559_RECEIPT,
        "publication-receipt.json",
    )
    t560_matrix, t560_matrix_bytes = _bind_exact(
        crosswalk_root / "candidate-score-matrix-authority-none.json",
        "T560 matrix",
        FROZEN_T560_MATRIX,
        "candidate-score-matrix-authority-none.json",
    )
    t560_crosswalk, t560_bytes = _bind_exact(
        crosswalk_root / "panorama-image2d-crosswalk-authority-none.json",
        "T560 crosswalk",
        FROZEN_T560_CROSSWALK,
        "panorama-image2d-crosswalk-authority-none.json",
    )
    t560_receipt, t560_receipt_bytes = _bind_exact(
        crosswalk_root / "publication-receipt.json",
        "T560 receipt",
        FROZEN_T560_RECEIPT,
        "publication-receipt.json",
    )
    camera_subset, subset_bytes = _bind_exact(subset_path, "camera subset", FROZEN_CAMERA_SUBSET, subset_path.name)
    t559 = load_strict_json(t559_bytes, "T559 manifest")
    t559_receipt_value = load_strict_json(t559_receipt_bytes, "T559 receipt")
    if t559.get("authority") != "none" or t559.get("schemaVersion") != "venviewer.e57-image2d-evidence.v1":
        raise ValueError("T559 schema or authority drifted")
    if (
        t559_receipt_value.get("authority") != "none"
        or _dict(t559_receipt_value.get("manifest"), "T559 receipt manifest").get(
            "sha256"
        )
        != FROZEN_T559_MANIFEST[1]
    ):
        raise ValueError("T559 receipt no longer binds its manifest")
    t560_receipt_value = load_strict_json(t560_receipt_bytes, "T560 receipt")
    if t560_receipt_value.get("authority") != "none" or t560_receipt_value.get("publicationComplete") is not True:
        raise ValueError("T560 receipt authority or completion drifted")
    receipt_files = _list(t560_receipt_value.get("files"), "T560 receipt files")
    expected_receipt_files = [
        {"relativePath": t560_matrix.relative_path, "sha256": t560_matrix.sha256, "sizeBytes": t560_matrix.size_bytes},
        {
            "relativePath": t560_crosswalk.relative_path,
            "sha256": t560_crosswalk.sha256,
            "sizeBytes": t560_crosswalk.size_bytes,
        },
    ]
    if receipt_files != expected_receipt_files:
        raise ValueError("T560 receipt file binding drifted")
    load_strict_json(t560_matrix_bytes, "T560 matrix")
    crosswalk = load_strict_json(t560_bytes, "T560 crosswalk")
    subset = load_strict_json(subset_bytes, "camera subset")
    rows = _selected_rows(subset, t559, image_root, crosswalk)
    files = (
        stage_manifest,
        e57,
        t559_manifest,
        t559_receipt,
        t560_matrix,
        t560_crosswalk,
        t560_receipt,
        camera_subset,
    )
    return PreparedInputs(
        files,
        stage_manifest,
        e57,
        t559_manifest,
        t559_receipt,
        t560_matrix,
        t560_crosswalk,
        t560_receipt,
        camera_subset,
        rows,
    )


class Pye57CaptureReader:
    def __init__(self, path: Path) -> None:
        import pye57

        self._capture = pye57.E57(str(path))

    def scan_count(self) -> int:
        return int(self._capture.scan_count)

    def header(self, scan_index: int) -> ScanHeader:
        header = self._capture.get_header(scan_index)
        return ScanHeader(
            str(header.guid),
            tuple(float(value) for value in header.rotation),
            tuple(float(value) for value in header.translation),
            int(header.point_count),
            frozenset(str(value) for value in header.point_fields),
            (
                float(header.xMinimum),
                float(header.xMaximum),
                float(header.yMinimum),
                float(header.yMaximum),
                float(header.zMinimum),
                float(header.zMaximum),
            ),
        )

    def read_scan_raw(self, scan_index: int) -> Mapping[str, NDArray[np.generic]]:
        return self._capture.read_scan_raw(scan_index)

    def close(self) -> None:
        self._capture.close()


def _decode_rgb(content: bytes) -> NDArray[np.uint8]:
    try:
        import cv2
    except ImportError as error:
        raise RuntimeError(
            "strict cubeface evidence requires the attested OpenCV decoder; "
            "no alternate decoder is permitted"
        ) from error
    encoded = np.frombuffer(content, dtype=np.uint8)
    decoded = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if decoded is None or decoded.shape != (4096, 4096, 3) or decoded.dtype != np.uint8:
        raise ValueError("T559 cubeface is not an exact decodable 4096x4096 JPEG")
    return np.ascontiguousarray(decoded[:, :, ::-1])


def _load_face(face: CubefaceSource) -> NDArray[np.uint8]:
    content = _read_stable(face.path, face.snapshot)
    if len(content) != face.size_bytes or sha256_bytes(content) != face.sha256:
        raise ValueError(f"T559 cubeface identity drifted: {face.relative_path}")
    return _decode_rgb(content)


def _verify_bound_files(prepared: PreparedInputs, *, include_e57_hash: bool) -> None:
    for item in prepared.source_files:
        if _snapshot(item.path) != item.snapshot:
            raise ValueError(f"frozen input identity changed: {item.label}")
        if item is prepared.e57:
            if include_e57_hash and sha256_file(item.path) != item.sha256:
                raise ValueError("staged E57 SHA-256 drifted")
            continue
        content = _read_stable(item.path, item.snapshot)
        if len(content) != item.size_bytes or sha256_bytes(content) != item.sha256:
            raise ValueError(f"frozen input bytes changed: {item.label}")
    for row in prepared.rows:
        for face in row.cubefaces:
            if _snapshot(face.path) != face.snapshot:
                raise ValueError(f"T559 cubeface identity changed: {face.relative_path}")


def _scan_arrays(
    raw: Mapping[str, NDArray[np.generic]], point_count: int
) -> tuple[
    NDArray[np.float64],
    NDArray[np.uint8],
    NDArray[np.generic],
    NDArray[np.generic],
    NDArray[np.generic],
]:
    if set(raw) != EXPECTED_FIELDS:
        raise ValueError("raw E57 point fields differ from the frozen contract")
    if any(len(raw[name]) != point_count for name in EXPECTED_FIELDS):
        raise ValueError("raw E57 point arrays differ from the header point count")
    expected_dtypes = {
        "cartesianX": np.dtype("float64"),
        "cartesianY": np.dtype("float64"),
        "cartesianZ": np.dtype("float64"),
        "cartesianInvalidState": np.dtype("int8"),
        "rowIndex": np.dtype("uint16"),
        "columnIndex": np.dtype("uint16"),
        "colorRed": np.dtype("uint8"),
        "colorGreen": np.dtype("uint8"),
        "colorBlue": np.dtype("uint8"),
    }
    if any(np.asarray(raw[name]).dtype != dtype for name, dtype in expected_dtypes.items()):
        raise ValueError("raw E57 point field dtypes differ from the frozen contract")
    points = np.column_stack((raw["cartesianX"], raw["cartesianY"], raw["cartesianZ"])).astype(np.float64, copy=False)
    raw_colors = np.column_stack((raw["colorRed"], raw["colorGreen"], raw["colorBlue"]))
    if not np.issubdtype(raw_colors.dtype, np.integer) or np.any(raw_colors < 0) or np.any(raw_colors > 255):
        raise ValueError("raw E57 colour fields are not uint8-range integral values")
    colors = raw_colors.astype(np.uint8, copy=False)
    return points, colors, raw["rowIndex"], raw["columnIndex"], raw["cartesianInvalidState"]


def _aabb_delta(
    points: NDArray[np.float64],
    invalid: NDArray[np.generic],
    rotation: NDArray[np.float64],
    translation: Sequence[float],
    expected: Sequence[float],
) -> tuple[int, float]:
    valid = np.asarray(invalid) == 0
    valid_count = int(np.count_nonzero(valid))
    if valid_count < MINIMUM_VALID_POINT_COUNT:
        raise ValueError("valid E57 point count is below the frozen threshold")
    global_points = points[valid] @ rotation.T + np.asarray(translation, dtype=np.float64)
    actual = (
        float(global_points[:, 0].min()),
        float(global_points[:, 0].max()),
        float(global_points[:, 1].min()),
        float(global_points[:, 1].max()),
        float(global_points[:, 2].min()),
        float(global_points[:, 2].max()),
    )
    delta = max(abs(left - right) for left, right in zip(actual, expected))
    if delta > MAXIMUM_AABB_DELTA_M:
        raise ValueError("transformed E57 points disagree with the Data3D cartesian bounds")
    return valid_count, delta


def _solve_scan(reader: CaptureReader, row: CandidateRow) -> dict[str, object]:
    header = reader.header(row.scan_index)
    if (
        header.guid != row.data3d_guid
        or header.point_count != EXPECTED_POINT_COUNT
        or header.point_fields != EXPECTED_FIELDS
    ):
        raise ValueError(f"Data3D header identity or point contract drifted for scan {row.scan_index}")
    if header.rotation_wxyz != row.quaternion_wxyz or header.translation_m != row.translation_m:
        raise ValueError(f"Data3D q/t differs from the exact camera subset for scan {row.scan_index}")
    rotation, quaternion_norm_error = quaternion_wxyz_to_rotation(header.rotation_wxyz)
    raw = reader.read_scan_raw(row.scan_index)
    points, colors, rows, columns, invalid = _scan_arrays(raw, header.point_count)
    valid_count, aabb_delta = _aabb_delta(points, invalid, rotation, header.translation_m, header.bounds)
    sample = deterministic_scanner_sample(
        points,
        colors,
        rows,
        columns,
        invalid,
        modulus=SAMPLE_MODULUS,
        minimum_range_m=MINIMUM_RANGE_M,
    )
    face_solves = tuple(
        solve_face(sample, _load_face(face), face.face_index, INTRINSICS, THRESHOLDS)
        for face in row.cubefaces
    )
    winners = validate_cube_solution(face_solves)
    if winners != CANONICAL_FACE_BASIS_IDS:
        raise ValueError(
            f"scan {row.scan_index} recovered a proper but non-canonical cubeface basis"
        )
    return {
        "cameraCenterDiagnostic": {
            "centerOffsetFitRun": False,
            "reason": CAMERA_CENTER_DIAGNOSTIC_REASON,
            "scannerOriginUsedAsCandidateCenter": True,
            "state": "diagnostic_not_run_not_an_authority_gate",
        },
        "candidateCorrespondence": {
            "accepted": False,
            "caveat": row.crosswalk_caveat,
            "humanReviewRequired": True,
            "supportedCandidateCount": row.crosswalk_supported_candidate_count,
            "sweepNumber": row.sweep_number,
        },
        "cameraExtrinsics": [compose_camera_extrinsics(rotation, header.translation_m, value) for value in winners],
        "data3DGuid": row.data3d_guid,
        "data3DPose": {
            "coordinateFrame": "E57 file frame",
            "quaternionNormError": quaternion_norm_error,
            "rotationQuaternionWxyz": list(header.rotation_wxyz),
            "translationM": list(header.translation_m),
        },
        "faces": [face_solve_json(value) for value in face_solves],
        "pointEvidence": {
            "cartesianBoundsMaximumAbsDeltaM": aabb_delta,
            "pointCount": header.point_count,
            "sampleCount": len(sample.points),
            "sampleSha256": sample.digest,
            "validPointCount": valid_count,
        },
        "scanIndex": row.scan_index,
        "winningBasisIds": list(winners),
    }


def _source_binding(item: BoundFile) -> dict[str, object]:
    return {
        "relativePath": item.relative_path,
        "sha256": item.sha256,
        "sizeBytes": item.size_bytes,
    }


def _frozen_selected_t559_bindings() -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for offset, (size_bytes, digest) in enumerate(FROZEN_SELECTED_T559_FILES):
        scan_index = 40 + offset // 6
        face_index = offset % 6
        image_index = 240 + offset
        result.append(
            {
                "data3DGuid": FROZEN_SCAN_GUIDS[scan_index - 40],
                "faceIndex": face_index,
                "imageIndex": image_index,
                "relativePath": (
                    f"images/scan_{scan_index:03d}/"
                    f"image2d_{image_index}_skybox_{face_index}.jpg"
                ),
                "sha256": digest,
                "sizeBytes": size_bytes,
            }
        )
    return result


def _frozen_source_bindings() -> dict[str, object]:
    return {
        "cameraSubset": {
            "relativePath": "grand-hall-camera-metric-subset-authority-none-v1.json",
            "sha256": FROZEN_CAMERA_SUBSET[1],
            "sizeBytes": FROZEN_CAMERA_SUBSET[0],
        },
        "captureStageManifest": {
            "relativePath": "capture-stage-manifest.json",
            "sha256": FROZEN_STAGE_MANIFEST[1],
            "sizeBytes": FROZEN_STAGE_MANIFEST[0],
        },
        "selectedT559Cubefaces": _frozen_selected_t559_bindings(),
        "sourceE57": {
            "relativePath": "source/e57/cloud_0.e57",
            "sha256": FROZEN_E57[1],
            "sizeBytes": FROZEN_E57[0],
        },
        "t559Manifest": {
            "relativePath": "image2d-inventory-authority-none.json",
            "sha256": FROZEN_T559_MANIFEST[1],
            "sizeBytes": FROZEN_T559_MANIFEST[0],
        },
        "t559Receipt": {
            "relativePath": "publication-receipt.json",
            "sha256": FROZEN_T559_RECEIPT[1],
            "sizeBytes": FROZEN_T559_RECEIPT[0],
        },
        "t560Crosswalk": {
            "relativePath": "panorama-image2d-crosswalk-authority-none.json",
            "sha256": FROZEN_T560_CROSSWALK[1],
            "sizeBytes": FROZEN_T560_CROSSWALK[0],
        },
        "t560Matrix": {
            "relativePath": "candidate-score-matrix-authority-none.json",
            "sha256": FROZEN_T560_MATRIX[1],
            "sizeBytes": FROZEN_T560_MATRIX[0],
        },
        "t560Receipt": {
            "relativePath": "publication-receipt.json",
            "sha256": FROZEN_T560_RECEIPT[1],
            "sizeBytes": FROZEN_T560_RECEIPT[0],
        },
    }


def _source_file_identity(path: Path, relative_path: str) -> dict[str, object]:
    snapshot = _snapshot(path)
    content = _read_stable(path, snapshot)
    return {"relativePath": relative_path, "sha256": sha256_bytes(content), "sizeBytes": len(content)}


def _runtime_identity(evidence_grade_ready: bool = False) -> dict[str, object]:
    import pye57
    import pyquaternion

    pye57_root = Path(pye57.__file__).resolve(strict=True).parent
    native_paths = sorted(pye57_root.glob("libe57*.pyd")) + [pye57_root / "xerces-c_3_2.dll"]
    if len(native_paths) != 2 or any(not path.is_file() for path in native_paths):
        raise ValueError("pye57 native runtime inventory differs from the strict contract")
    native = [_source_file_identity(path, path.name) for path in native_paths]
    executable = Path(sys.executable).resolve(strict=True)
    dependencies: dict[str, object] = {
        "numpy": {
            "origin": str(Path(np.__file__).resolve(strict=True)),
            "version": importlib.metadata.version("numpy"),
        },
        "pye57": {
            "origin": str(Path(pye57.__file__).resolve(strict=True)),
            "version": importlib.metadata.version("pye57"),
        },
        "pyquaternion": {
            "origin": str(Path(pyquaternion.__file__).resolve(strict=True)),
            "version": importlib.metadata.version("pyquaternion"),
        },
    }
    try:
        import cv2
    except ImportError as error:
        raise RuntimeError(
            "strict cubeface evidence requires the attested OpenCV runtime"
        ) from error
    dependencies["opencv-python-headless"] = {
        "origin": str(Path(cv2.__file__).resolve(strict=True)),
        "version": importlib.metadata.version("opencv-python-headless"),
    }
    decoder = "opencv_imdecode_color_bgr_to_rgb"
    return {
        "decoderBackend": decoder,
        "dependencies": dependencies,
        "evidenceGradeHermeticRuntimeReady": evidence_grade_ready,
        "nativePye57Files": native,
        "python": {
            "executable": str(executable),
            "executableSha256": sha256_file(executable),
            "implementation": sys.implementation.name,
            "version": sys.version,
        },
    }


def _runtime_tree_identity(root: Path) -> dict[str, object]:
    files: list[dict[str, object]] = []
    for path in sorted(root.rglob("*"), key=lambda value: value.relative_to(root).as_posix()):
        if path.is_dir():
            if _is_link_or_reparse(path):
                raise ValueError("hermetic runtime contains a linked or reparse directory")
            continue
        relative = path.relative_to(root).as_posix()
        if path.suffix.lower() == ".pyc" or "__pycache__" in path.parts:
            raise ValueError("hermetic runtime contains generated bytecode")
        snapshot = _snapshot(path)
        content = _read_stable(path, snapshot)
        files.append(
            {
                "relativePath": relative,
                "sha256": sha256_bytes(content),
                "sizeBytes": len(content),
            }
        )
    return {
        "fileCount": len(files),
        "sha256": sha256_bytes(canonical_json_bytes(files)),
    }


def _installed_distribution_identity(root: Path, name: str) -> dict[str, object]:
    """Recompute one installed distribution from its RECORD-backed file set."""
    distribution = importlib.metadata.distribution(name)
    canonical_name = re.sub(r"[-_.]+", "-", str(distribution.metadata["Name"])).lower()
    if canonical_name != name:
        raise ValueError(f"installed distribution name canonicalises unexpectedly: {name}")
    expected_version, wheel_sha256 = EXPECTED_DISTRIBUTIONS[name]
    if distribution.version != expected_version:
        raise ValueError(f"installed distribution version drifted: {name}")
    declared_files = distribution.files
    if declared_files is None or not declared_files:
        raise ValueError(f"installed distribution has no RECORD-backed file set: {name}")
    files: list[dict[str, object]] = []
    seen: set[str] = set()
    for declared in declared_files:
        located = Path(distribution.locate_file(declared)).resolve(strict=True)
        located = _verify_path_chain(
            located,
            f"installed distribution file for {name}",
            must_exist=True,
        )
        try:
            relative = located.relative_to(root).as_posix()
        except ValueError as error:
            raise ValueError(f"installed distribution file escapes runtime: {name}") from error
        if relative in seen:
            raise ValueError(f"installed distribution repeats one runtime file: {name}")
        seen.add(relative)
        snapshot = _snapshot(located)
        content = _read_stable(located, snapshot)
        files.append(
            {
                "relativePath": relative,
                "sha256": sha256_bytes(content),
                "sizeBytes": len(content),
            }
        )
    files.sort(key=lambda value: str(value["relativePath"]))
    return {
        "installedFileCount": len(files),
        "installedTreeSha256": sha256_bytes(canonical_json_bytes(files)),
        "name": name,
        "version": expected_version,
        "wheelSha256": wheel_sha256,
    }


def _assert_hermetic_runtime_process(
    root: Path, controls: dict[str, object]
) -> object:
    if root != Path(sys.prefix).resolve(strict=True):
        raise ValueError("the active Python prefix is not the attested hermetic runtime")
    for name, value in controls.items():
        if not isinstance(value, str) or os.environ.get(name) != value:
            raise ValueError("hermetic runtime environment controls are absent or drifted")
    if os.environ.get("PYTHONPATH") is not None or not sys.dont_write_bytecode:
        raise ValueError("hermetic runtime requires no PYTHONPATH and disabled bytecode writes")
    import cv2
    import pye57
    import pyquaternion
    import site

    for module in (np, cv2, pye57, pyquaternion):
        origin = Path(module.__file__).resolve(strict=True)
        try:
            origin.relative_to(root)
        except ValueError as error:
            raise ValueError("numeric dependency imported outside the hermetic runtime") from error
    for name, (version, _wheel_sha256) in EXPECTED_DISTRIBUTIONS.items():
        if importlib.metadata.version(name) != version:
            raise ValueError(f"numeric dependency version drifted: {name}")
    cv2.setNumThreads(1)
    cv2.ocl.setUseOpenCL(False)
    if (
        not sys.flags.isolated
        or not sys.flags.ignore_environment
        or not sys.flags.safe_path
        or not sys.flags.no_user_site
        or not sys.dont_write_bytecode
        or site.ENABLE_USER_SITE is not False
    ):
        raise ValueError("evidence runtime requires isolated, safe, no-user-site Python")
    return cv2


def _runtime_attestation_payload(
    root: Path, controls: dict[str, object]
) -> dict[str, object]:
    """Build the exact canonical attestation later enforced during every solve."""
    cv2 = _assert_hermetic_runtime_process(root, controls)
    executable = Path(sys.executable).resolve(strict=True)
    try:
        executable_relative = executable.relative_to(root).as_posix()
    except ValueError as error:
        raise ValueError("runtime Python executable escapes its prefix") from error
    if executable_relative != "Scripts/python.exe":
        raise ValueError("runtime Python executable path differs from the frozen contract")
    executable_snapshot = _snapshot(executable)
    native_files = []
    for relative in REQUIRED_NATIVE_PATHS:
        path = _relative_file(root, relative, "runtime native file")
        snapshot = _snapshot(path)
        content = _read_stable(path, snapshot)
        native_files.append(
            {
                "relativePath": relative,
                "sha256": sha256_bytes(content),
                "sizeBytes": len(content),
            }
        )
    return {
        "completeTree": _runtime_tree_identity(root),
        "installedDistributions": [
            _installed_distribution_identity(root, name)
            for name in sorted(EXPECTED_DISTRIBUTIONS)
        ],
        "nativeFiles": native_files,
        "opencv": {
            "buildInformationSha256": sha256_bytes(
                cv2.getBuildInformation().encode("utf-8")
            ),
            "openClEnabled": bool(cv2.ocl.useOpenCL()),
            "threadCount": int(cv2.getNumThreads()),
        },
        "pythonExecutable": {
            "relativePath": executable_relative,
            "sha256": sha256_file(executable),
            "sizeBytes": executable_snapshot.size_bytes,
        },
    }


def generate_runtime_attestation(repo_root: Path) -> dict[str, object]:
    """Read-only attestation generator; callers must review before contract activation."""
    relative = (
        "tools/twin-forge/e57-scripts/"
        "e57-cubeface-extrinsics-dependency-bootstrap-authority-none.json"
    )
    path = repo_root / relative
    snapshot = _snapshot(path)
    contract = load_strict_json(
        _read_stable(path, snapshot), "cubeface dependency contract"
    )
    if contract.get("schemaVersion") != DEPENDENCY_CONTRACT_SCHEMA:
        raise ValueError("cubeface dependency contract schema drifted")
    candidate = _dict(contract.get("runtimeCandidate"), "runtime candidate")
    root = _verify_path_chain(
        Path(_string(candidate.get("path"), "runtime candidate path")),
        "hermetic runtime root",
        must_exist=True,
    )
    controls = _dict(contract.get("environmentControls"), "runtime environment controls")
    return _runtime_attestation_payload(root, controls)


def _require_dependency_runtime_activation(repo_root: Path) -> RuntimeActivation:
    relative = (
        "tools/twin-forge/e57-scripts/"
        "e57-cubeface-extrinsics-dependency-bootstrap-authority-none.json"
    )
    path = repo_root / relative
    snapshot = _snapshot(path)
    contract_bytes = _read_stable(path, snapshot)
    contract = load_strict_json(contract_bytes, "cubeface dependency contract")
    if contract.get("schemaVersion") != DEPENDENCY_CONTRACT_SCHEMA or contract.get("authority") != "none":
        raise ValueError("cubeface dependency contract schema or authority drifted")
    if contract.get("bootstrapRequired") is not False:
        raise ValueError("cubeface dependency wheels have not been bootstrapped")
    if contract.get("evidenceGradeBuildPermitted") is not True:
        raise ValueError(
            "cubeface dependency runtime is built but its tree/native attestation is pending"
        )
    attestation = _dict(contract.get("runtimeAttestation"), "runtime attestation")
    candidate = _dict(contract.get("runtimeCandidate"), "runtime candidate")
    root = _verify_path_chain(
        Path(_string(candidate.get("path"), "runtime candidate path")),
        "hermetic runtime root",
        must_exist=True,
    )
    controls = _dict(contract.get("environmentControls"), "runtime environment controls")
    actual_attestation = _runtime_attestation_payload(root, controls)
    if attestation != actual_attestation:
        raise ValueError("hermetic runtime differs from its complete canonical attestation")
    actual_tree = _dict(actual_attestation.get("completeTree"), "runtime complete tree")
    return RuntimeActivation(
        sha256_bytes(contract_bytes),
        _string(actual_tree.get("sha256"), "runtime tree SHA-256"),
        _integer(actual_tree.get("fileCount"), "runtime tree file count"),
    )


def _git_head(repo_root: Path) -> str:
    process = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )
    return process.stdout.strip()


def _generator_binding(repo_root: Path, reviewed_git_sha: str) -> dict[str, object]:
    if GIT_SHA_RE.fullmatch(reviewed_git_sha) is None or _git_head(repo_root) != reviewed_git_sha:
        raise ValueError("reviewed Git SHA must exactly match the current worktree HEAD")
    expected_origins = {
        "e57_image2d_evidence": repo_root / "tools/twin-forge/e57-scripts/e57_image2d_evidence.py",
        "e57_stage_guard": repo_root / "tools/twin-forge/e57-scripts/e57_stage_guard.py",
        "grand_hall_e57_cubeface_extrinsics": (
            repo_root
            / "tools/twin-forge/e57-scripts/grand_hall_e57_cubeface_extrinsics.py"
        ),
    }
    expected_builder = (
        repo_root
        / "tools/twin-forge/e57-scripts/build_grand_hall_e57_cubeface_extrinsics.py"
    )
    if Path(__file__).resolve(strict=True) != expected_builder.resolve(strict=True):
        raise ValueError("executing builder origin differs from the reviewed repository file")
    for module_name, expected in expected_origins.items():
        module = sys.modules.get(module_name)
        origin = None if module is None else getattr(module, "__file__", None)
        if origin is None or Path(origin).resolve(strict=True) != expected.resolve(strict=True):
            raise ValueError(f"reviewed local module origin drifted: {module_name}")
    for relative in GENERATOR_RELATIVE_PATHS:
        tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", relative],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
        if tracked.returncode != 0:
            raise ValueError(f"generator file is not tracked by the reviewed commit: {relative}")
        working_blob = subprocess.run(
            ["git", "hash-object", "--", relative],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        head_blob = subprocess.run(
            ["git", "rev-parse", f"HEAD:{relative}"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if working_blob != head_blob:
            raise ValueError(f"generator file differs from the reviewed commit: {relative}")
    return {
        "files": [
            _source_file_identity(repo_root / relative, relative)
            for relative in GENERATOR_RELATIVE_PATHS
        ],
        "reviewedGitSha": reviewed_git_sha,
    }


def _permissions() -> dict[str, bool]:
    return {
        "correspondenceAccepted": False,
        "humanRoomAcceptanceInferred": False,
        "metricTransformAuthorityGranted": False,
        "productionTrustPermitted": False,
        "providerInputPermitted": False,
        "publicationPermitted": False,
        "publicExposurePermitted": False,
        "reconstructionInputPermitted": False,
        "roomMembershipAccepted": False,
        "runtimeInputPermitted": False,
        "stagingPermitted": False,
        "trainingInputPermitted": False,
    }


def _frozen_configuration() -> dict[str, object]:
    return {
        "cameraConvention": {
            "cameraAxes": "x=right,y=down,z=forward",
            "cameraFromE57": "R_camera_from_e57=transpose(R_e57_from_camera); t=-R_camera_from_e57*C_e57",
            "e57FromCamera": "R_e57_from_camera=R_e57_from_scanner*[right,down,forward]",
        },
        "cartesianBoundsMaximumAbsDeltaM": MAXIMUM_AABB_DELTA_M,
        "coverage": {"binGridHeight": 8, "binGridWidth": 8},
        "intrinsics": {
            "focalX": INTRINSICS.focal_x,
            "focalY": INTRINSICS.focal_y,
            "height": INTRINSICS.height,
            "principalX": INTRINSICS.principal_x,
            "principalY": INTRINSICS.principal_y,
            "width": INTRINSICS.width,
        },
        "luminance": {
            "blueCoefficient": 0.0722,
            "greenCoefficient": 0.7152,
            "model": "ITU-R_BT.709",
            "redCoefficient": 0.2126,
        },
        "minimumRangeMExclusive": MINIMUM_RANGE_M,
        "minimumValidPointCount": MINIMUM_VALID_POINT_COUNT,
        "projection": {
            "depthEpsilonExclusive": 1e-9,
            "pixelSampling": "floor",
        },
        "ranking": "luminanceNcc_desc,rgbMae_asc,basisId_asc",
        "samplePredicate": (
            "invalidState==0 && rowIndex%8==0 && columnIndex%8==0 && "
            "rangeM>0; sort(rowIndex,columnIndex,sourceIndex)"
        ),
        "signedAxisCandidateCount": 48,
        "thresholds": thresholds_json(THRESHOLDS),
    }


def _derive_evidence_result(
    prepared: PreparedInputs,
    reviewed_git_sha: str,
    repo_root: Path,
    activation: RuntimeActivation,
) -> dict[str, object]:
    row_by_scan = {row.scan_index: row for row in prepared.rows}
    reader = Pye57CaptureReader(prepared.e57.path)
    try:
        if reader.scan_count() != 149:
            raise ValueError("staged E57 scan count drifted")
        scans = [_solve_scan(reader, row_by_scan[index]) for index in EXPECTED_SCANS]
    finally:
        reader.close()
    expected_winners = scans[0]["winningBasisIds"]
    if any(scan["winningBasisIds"] != expected_winners for scan in scans[1:]):
        raise ValueError("candidate scans do not recover one coherent identical cubeface basis")
    generator = _generator_binding(repo_root, reviewed_git_sha)
    configuration = _frozen_configuration()
    selected_images = [
        {
            "data3DGuid": face.data3d_guid,
            "faceIndex": face.face_index,
            "imageIndex": face.image_index,
            "relativePath": face.relative_path,
            "sha256": face.sha256,
            "sizeBytes": face.size_bytes,
        }
        for row in prepared.rows
        for face in row.cubefaces
    ]
    source_bindings = {
        "cameraSubset": _source_binding(prepared.camera_subset),
        "captureStageManifest": _source_binding(prepared.stage_manifest),
        "selectedT559Cubefaces": selected_images,
        "sourceE57": _source_binding(prepared.e57),
        "t559Manifest": _source_binding(prepared.t559_manifest),
        "t559Receipt": _source_binding(prepared.t559_receipt),
        "t560Crosswalk": _source_binding(prepared.t560_crosswalk),
        "t560Matrix": _source_binding(prepared.t560_matrix),
        "t560Receipt": _source_binding(prepared.t560_receipt),
    }
    if source_bindings != _frozen_source_bindings():
        raise ValueError("frozen source bindings differ from the exact reviewed set")
    return {
        "authority": "none",
        "configuration": configuration,
        "configurationSha256": sha256_bytes(canonical_json_bytes(configuration)),
        "contract": {
            "dependencyBootstrapRequired": False,
            "evidenceGradeDependencyAttestationPassed": True,
            "machineVerificationPassed": True,
            "orientationAuthority": "none",
            "permissions": _permissions(),
            "storedImage2DPoseHandling": "not_read_not_used",
            "truthScope": TRUTH_SCOPE,
        },
        "generator": generator,
        "generatorSha256": sha256_bytes(canonical_json_bytes(generator)),
        "runtime": {
            **_runtime_identity(True),
            "activation": {
                "contractSha256": activation.contract_sha256,
                "runtimeTreeFileCount": activation.runtime_tree_file_count,
                "runtimeTreeSha256": activation.runtime_tree_sha256,
            },
        },
        "scanResults": scans,
        "schemaVersion": RESULT_SCHEMA,
        "sourceBindings": source_bindings,
        "summary": {
            "allRequestedScansRecoveredIdenticalProperCube": True,
            "evidenceGradeVerificationPassed": True,
            "faceCount": len(scans) * 6,
            "machineVerificationPassed": True,
            "requestedScanIndices": list(EXPECTED_SCANS),
            "scanCount": len(scans),
            "winnerAuthority": "none",
        },
    }


def _write_exclusive(path: Path, content: bytes) -> None:
    with path.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def build_receipt(result_bytes: bytes, result: dict[str, object]) -> dict[str, object]:
    source_bindings = _dict(result.get("sourceBindings"), "result source bindings")
    return {
        "authority": "none",
        "configurationSha256": result["configurationSha256"],
        "evidenceGradeDependencyAttestationPassed": _dict(
            result.get("contract"), "result contract"
        ).get("evidenceGradeDependencyAttestationPassed"),
        "files": [{"relativePath": RESULT_NAME, "sha256": sha256_bytes(result_bytes), "sizeBytes": len(result_bytes)}],
        "generatorSha256": result["generatorSha256"],
        "permissions": _permissions(),
        "publicationComplete": True,
        "receiptWrittenLast": True,
        "schemaVersion": RECEIPT_SCHEMA,
        "sourceBindingsSha256": sha256_bytes(canonical_json_bytes(source_bindings)),
    }


def _pack_inventory(root: Path) -> set[str]:
    if _is_link_or_reparse(root) or not root.is_dir():
        raise ValueError("cubeface solve pack root must be a real directory")
    entries = list(root.iterdir())
    if any(_is_link_or_reparse(path) or not path.is_file() or path.stat().st_nlink != 1 for path in entries):
        raise ValueError("cubeface solve pack contains linked, hard-linked, or non-regular entries")
    return {path.name for path in entries}


def _verify_pack_contents(root: Path, expected_result: dict[str, object]) -> None:
    if _pack_inventory(root) != {RESULT_NAME, RECEIPT_NAME}:
        raise ValueError("cubeface solve pack inventory is incomplete or unexpected")
    paths = {name: root / name for name in (RESULT_NAME, RECEIPT_NAME)}
    snapshots = {name: _snapshot(path) for name, path in paths.items()}
    result_bytes = _read_stable(paths[RESULT_NAME], snapshots[RESULT_NAME])
    receipt_bytes = _read_stable(paths[RECEIPT_NAME], snapshots[RECEIPT_NAME])
    result = load_strict_json(result_bytes, "cubeface solve result")
    receipt = load_strict_json(receipt_bytes, "cubeface solve receipt")
    if result_bytes != canonical_json_bytes(result) or receipt_bytes != canonical_json_bytes(receipt):
        raise ValueError("cubeface solve pack is not canonical JSON")
    if result != expected_result:
        raise ValueError("cubeface solve result differs from fresh source recomputation")
    _validate_result_contract(result)
    expected_receipt = build_receipt(result_bytes, result)
    if receipt != expected_receipt:
        raise ValueError("cubeface solve receipt does not bind the exact completed result")
    if _pack_inventory(root) != {RESULT_NAME, RECEIPT_NAME} or any(
        _snapshot(paths[name]) != snapshots[name] for name in paths
    ):
        raise ValueError("cubeface solve pack changed during verification")


def verify_pack(root: Path, expected_result: dict[str, object]) -> None:
    resolved = _verify_path_chain(root, "cubeface solve pack", must_exist=True)
    with windows_directory_identity_lease(resolved.parent):
        with windows_directory_identity_lease(resolved) as identity:
            _verify_pack_contents(resolved, expected_result)
            if _directory_snapshot(resolved) != identity:
                raise ValueError("cubeface solve pack directory identity changed")


def _finite_number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{label} must be finite")
    return result


def _basis_score_from_json(value: object, label: str) -> BasisScore:
    item = _dict(value, label)
    _require_exact_keys(
        item,
        {
            "basisId",
            "coverageBinCount",
            "determinant",
            "luminanceNcc",
            "rgbMae",
            "sampleCount",
        },
        label,
    )
    basis_id = _string(item.get("basisId"), f"{label} basis")
    basis = BASIS_BY_ID.get(basis_id)
    if basis is None or item.get("determinant") != basis.determinant:
        raise ValueError(f"{label} basis identity or determinant drifted")
    sample_count = _integer(item.get("sampleCount"), f"{label} sample count")
    coverage = _integer(item.get("coverageBinCount"), f"{label} coverage")
    if sample_count < 0 or coverage not in range(65):
        raise ValueError(f"{label} count or coverage is outside bounds")
    ncc_raw = item.get("luminanceNcc")
    mae_raw = item.get("rgbMae")
    ncc = None if ncc_raw is None else _finite_number(ncc_raw, f"{label} NCC")
    mae = None if mae_raw is None else _finite_number(mae_raw, f"{label} MAE")
    if (ncc is None) != (mae is None) or (ncc is not None and not -1.0 <= ncc <= 1.0):
        raise ValueError(f"{label} NCC/MAE nullability or bounds drifted")
    if mae is not None and mae < 0.0:
        raise ValueError(f"{label} MAE cannot be negative")
    return BasisScore(basis_id, basis.determinant, sample_count, coverage, ncc, mae)


def _validate_face_result(value: object, face_index: int) -> None:
    face = _dict(value, f"face {face_index}")
    _require_exact_keys(face, {"faceIndex", "runnerUp", "scores", "winner"}, f"face {face_index}")
    if face.get("faceIndex") != face_index:
        raise ValueError("face index order drifted")
    scores = [
        _basis_score_from_json(item, f"face {face_index} score")
        for item in _list(face.get("scores"), f"face {face_index} scores")
    ]
    if [item.basis_id for item in scores] != [item.basis_id for item in SIGNED_AXIS_BASES]:
        raise ValueError("face score matrix is not the complete ordered 48-basis universe")
    ranked = sorted(scores, key=_score_sort_key)
    if face.get("winner") != basis_score_json(ranked[0]) or face.get("runnerUp") != basis_score_json(ranked[1]):
        raise ValueError("face winner or runner does not derive from the complete score matrix")
    if ranked[0].basis_id != CANONICAL_FACE_BASIS_IDS[face_index]:
        raise ValueError("face winner differs from the canonical real-data basis")
    _require_face_gates(ranked[0], ranked[1], THRESHOLDS, face_index)


def _validate_scan_result(scan: dict[str, object], scan_index: int) -> None:
    _require_exact_keys(
        scan,
        {
            "cameraCenterDiagnostic",
            "cameraExtrinsics",
            "candidateCorrespondence",
            "data3DGuid",
            "data3DPose",
            "faces",
            "pointEvidence",
            "scanIndex",
            "winningBasisIds",
        },
        f"scan {scan_index}",
    )
    if scan.get("scanIndex") != scan_index or scan.get("winningBasisIds") != list(CANONICAL_FACE_BASIS_IDS):
        raise ValueError("scan identity or canonical winner tuple drifted")
    if scan.get("data3DGuid") != FROZEN_SCAN_GUIDS[scan_index - 40]:
        raise ValueError("Data3D GUID differs from the exact frozen candidate scan")
    quaternion, translation, sweep_number, supported_count, caveat = (
        FROZEN_CANDIDATE_ROWS[scan_index - 40]
    )
    diagnostic = _dict(scan.get("cameraCenterDiagnostic"), "camera center diagnostic")
    candidate = _dict(scan.get("candidateCorrespondence"), "candidate correspondence")
    expected_diagnostic = {
        "centerOffsetFitRun": False,
        "reason": CAMERA_CENTER_DIAGNOSTIC_REASON,
        "scannerOriginUsedAsCandidateCenter": True,
        "state": "diagnostic_not_run_not_an_authority_gate",
    }
    expected_candidate = {
        "accepted": False,
        "caveat": caveat,
        "humanReviewRequired": True,
        "supportedCandidateCount": supported_count,
        "sweepNumber": sweep_number,
    }
    if diagnostic != expected_diagnostic or candidate != expected_candidate:
        raise ValueError("scan center or correspondence authority drifted")
    point = _dict(scan.get("pointEvidence"), "point evidence")
    _require_exact_keys(
        point,
        {
            "cartesianBoundsMaximumAbsDeltaM",
            "pointCount",
            "sampleCount",
            "sampleSha256",
            "validPointCount",
        },
        "point evidence",
    )
    if (
        point.get("pointCount") != EXPECTED_POINT_COUNT
        or _integer(point.get("validPointCount"), "valid point count") < MINIMUM_VALID_POINT_COUNT
        or _integer(point.get("sampleCount"), "sample count") < THRESHOLDS.minimum_samples_per_face
        or SHA256_RE.fullmatch(_string(point.get("sampleSha256"), "sample SHA-256")) is None
        or _finite_number(point.get("cartesianBoundsMaximumAbsDeltaM"), "AABB delta")
        > MAXIMUM_AABB_DELTA_M
    ):
        raise ValueError("point evidence fails the frozen metric gates")
    pose = _dict(scan.get("data3DPose"), "Data3D pose")
    rotation, norm_error = quaternion_wxyz_to_rotation(quaternion)
    expected_pose = {
        "coordinateFrame": "E57 file frame",
        "quaternionNormError": norm_error,
        "rotationQuaternionWxyz": list(quaternion),
        "translationM": list(translation),
    }
    if pose != expected_pose:
        raise ValueError("Data3D pose differs from the exact frozen candidate row")
    faces = _list(scan.get("faces"), "face solves")
    if len(faces) != 6:
        raise ValueError("scan must contain exactly six face solves")
    for face_index, face in enumerate(faces):
        _validate_face_result(face, face_index)
    expected_extrinsics = [
        compose_camera_extrinsics(rotation, translation, basis_id)
        for basis_id in CANONICAL_FACE_BASIS_IDS
    ]
    if scan.get("cameraExtrinsics") != expected_extrinsics:
        raise ValueError("camera extrinsics do not derive from Data3D q/t and the canonical bases")


def _validate_generator_record(generator: dict[str, object]) -> None:
    _require_exact_keys(generator, {"files", "reviewedGitSha"}, "result generator")
    reviewed = _string(generator.get("reviewedGitSha"), "reviewed Git SHA")
    if GIT_SHA_RE.fullmatch(reviewed) is None or reviewed == "0" * 40:
        raise ValueError("reviewed Git SHA is not a concrete commit")
    files = [_dict(value, "generator file") for value in _list(generator.get("files"), "generator files")]
    if [item.get("relativePath") for item in files] != list(GENERATOR_RELATIVE_PATHS):
        raise ValueError("generator file set/order differs from the frozen executable surface")
    for item in files:
        _require_exact_keys(item, {"relativePath", "sha256", "sizeBytes"}, "generator file")
        if (
            SHA256_RE.fullmatch(_string(item.get("sha256"), "generator file SHA-256")) is None
            or _integer(item.get("sizeBytes"), "generator file size") <= 0
        ):
            raise ValueError("generator file identity is incomplete")


def _validate_runtime_record(runtime: dict[str, object], generator: dict[str, object]) -> None:
    _require_exact_keys(
        runtime,
        {
            "activation",
            "decoderBackend",
            "dependencies",
            "evidenceGradeHermeticRuntimeReady",
            "nativePye57Files",
            "python",
        },
        "result runtime",
    )
    activation = _dict(runtime.get("activation"), "runtime activation")
    _require_exact_keys(
        activation,
        {"contractSha256", "runtimeTreeFileCount", "runtimeTreeSha256"},
        "runtime activation",
    )
    generator_files = [_dict(value, "generator file") for value in _list(generator.get("files"), "generator files")]
    dependency_binding = generator_files[GENERATOR_RELATIVE_PATHS.index(
        "tools/twin-forge/e57-scripts/e57-cubeface-extrinsics-dependency-bootstrap-authority-none.json"
    )]
    if (
        activation.get("contractSha256") != dependency_binding.get("sha256")
        or activation.get("runtimeTreeFileCount") != FROZEN_RUNTIME_TREE[0]
        or activation.get("runtimeTreeSha256") != FROZEN_RUNTIME_TREE[1]
    ):
        raise ValueError("runtime activation does not cross-bind the frozen dependency contract/tree")
    dependencies = _dict(runtime.get("dependencies"), "runtime dependencies")
    if set(dependencies) != set(EXPECTED_DISTRIBUTIONS):
        raise ValueError("runtime dependency set differs from the exact hermetic set")
    expected_origins = {
        "numpy": FROZEN_RUNTIME_ROOT / "Lib/site-packages/numpy/__init__.py",
        "opencv-python-headless": FROZEN_RUNTIME_ROOT / "Lib/site-packages/cv2/__init__.py",
        "pye57": FROZEN_RUNTIME_ROOT / "Lib/site-packages/pye57/__init__.py",
        "pyquaternion": FROZEN_RUNTIME_ROOT / "Lib/site-packages/pyquaternion/__init__.py",
    }
    for name, expected_origin in expected_origins.items():
        value = _dict(dependencies.get(name), f"runtime dependency {name}")
        _require_exact_keys(value, {"origin", "version"}, f"runtime dependency {name}")
        origin = Path(_string(value.get("origin"), f"runtime dependency {name} origin"))
        if (
            os.path.normcase(str(origin)) != os.path.normcase(str(expected_origin))
            or value.get("version") != EXPECTED_DISTRIBUTIONS[name][0]
        ):
            raise ValueError(f"runtime dependency identity drifted: {name}")
    native = [
        _dict(value, "pye57 native file")
        for value in _list(runtime.get("nativePye57Files"), "pye57 native files")
    ]
    if native != list(FROZEN_PYE57_NATIVE_FILES):
        raise ValueError("pye57 native runtime identity drifted")
    python = _dict(runtime.get("python"), "runtime Python")
    _require_exact_keys(
        python,
        {"executable", "executableSha256", "implementation", "version"},
        "runtime Python",
    )
    if (
        os.path.normcase(_string(python.get("executable"), "runtime Python executable"))
        != os.path.normcase(str(FROZEN_RUNTIME_ROOT / "Scripts/python.exe"))
        or python.get("executableSha256") != FROZEN_PYTHON_EXECUTABLE[1]
        or python.get("implementation") != "cpython"
        or not _string(python.get("version"), "runtime Python version").startswith("3.12.12 ")
        or runtime.get("decoderBackend") != "opencv_imdecode_color_bgr_to_rgb"
        or runtime.get("evidenceGradeHermeticRuntimeReady") is not True
    ):
        raise ValueError("evidence-grade runtime identity drifted")


def _validate_result_contract(result: dict[str, object]) -> None:
    _require_exact_keys(
        result,
        {
            "authority",
            "configuration",
            "configurationSha256",
            "contract",
            "determinismVerification",
            "generator",
            "generatorSha256",
            "runtime",
            "scanResults",
            "schemaVersion",
            "sourceBindings",
            "summary",
        },
        "cubeface solve result",
    )
    if result.get("schemaVersion") != RESULT_SCHEMA or result.get("authority") != "none":
        raise ValueError("cubeface solve schema or authority drifted")
    configuration = _dict(result.get("configuration"), "result configuration")
    if (
        configuration != _frozen_configuration()
        or result.get("configurationSha256")
        != sha256_bytes(canonical_json_bytes(configuration))
    ):
        raise ValueError("cubeface solve configuration or digest drifted")
    generator = _dict(result.get("generator"), "result generator")
    _validate_generator_record(generator)
    if result.get("generatorSha256") != sha256_bytes(canonical_json_bytes(generator)):
        raise ValueError("cubeface solve generator digest drifted")
    contract = _dict(result.get("contract"), "result contract")
    _require_exact_keys(
        contract,
        {
            "dependencyBootstrapRequired",
            "evidenceGradeDependencyAttestationPassed",
            "machineVerificationPassed",
            "orientationAuthority",
            "permissions",
            "storedImage2DPoseHandling",
            "truthScope",
        },
        "result contract",
    )
    if (
        contract.get("dependencyBootstrapRequired") is not False
        or contract.get("evidenceGradeDependencyAttestationPassed") is not True
        or contract.get("machineVerificationPassed") is not True
        or contract.get("orientationAuthority") != "none"
        or contract.get("storedImage2DPoseHandling") != "not_read_not_used"
        or contract.get("permissions") != _permissions()
        or contract.get("truthScope") != TRUTH_SCOPE
    ):
        raise ValueError("cubeface solve truth or permission contract drifted")
    runtime = _dict(result.get("runtime"), "result runtime")
    _validate_runtime_record(runtime, generator)
    source_bindings = _dict(result.get("sourceBindings"), "result source bindings")
    if source_bindings != _frozen_source_bindings():
        raise ValueError("result source bindings differ from the exact frozen evidence set")
    determinism = _dict(result.get("determinismVerification"), "determinism verification")
    _require_exact_keys(
        determinism,
        {"attemptCount", "attemptIsolation", "attemptResultSha256"},
        "determinism verification",
    )
    attempt_hashes = _list(determinism.get("attemptResultSha256"), "determinism attempt hashes")
    base_result = dict(result)
    del base_result["determinismVerification"]
    base_digest = sha256_bytes(canonical_json_bytes(base_result))
    if (
        determinism.get("attemptCount") != 3
        or determinism.get("attemptIsolation") != "fresh_pye57_reader_same_process"
        or attempt_hashes != [base_digest, base_digest, base_digest]
    ):
        raise ValueError("cubeface solve determinism verification drifted")
    summary = _dict(result.get("summary"), "result summary")
    _require_exact_keys(
        summary,
        {
            "allRequestedScansRecoveredIdenticalProperCube",
            "evidenceGradeVerificationPassed",
            "faceCount",
            "machineVerificationPassed",
            "requestedScanIndices",
            "scanCount",
            "winnerAuthority",
        },
        "result summary",
    )
    if (
        summary.get("winnerAuthority") != "none"
        or summary.get("allRequestedScansRecoveredIdenticalProperCube") is not True
        or summary.get("machineVerificationPassed") is not True
        or summary.get("evidenceGradeVerificationPassed") is not True
        or summary.get("requestedScanIndices") != list(EXPECTED_SCANS)
        or summary.get("scanCount") != len(EXPECTED_SCANS)
        or summary.get("faceCount") != len(EXPECTED_SCANS) * 6
    ):
        raise ValueError("cubeface solve summary authority drifted")
    scans = [_dict(value, "scan result") for value in _list(result.get("scanResults"), "scan results")]
    if [scan.get("scanIndex") for scan in scans] != list(EXPECTED_SCANS):
        raise ValueError("cubeface solve must contain exact scans 40 through 47")
    for scan_index, scan in zip(EXPECTED_SCANS, scans):
        _validate_scan_result(scan, scan_index)


def publish_pack(output: Path, result: dict[str, object], race_hook: RaceHook = _noop_hook) -> None:
    result_bytes = canonical_json_bytes(result)
    receipt = build_receipt(result_bytes, result)
    parent = _verify_path_chain(output.parent, "publication parent", must_exist=True)
    with windows_directory_identity_lease(parent):
        if output.parent.resolve(strict=True) != parent:
            raise ValueError("publication output parent identity drifted")
        race_hook("before-publication-stage", output)
        staged_identity: DirectorySnapshot | None = None
        with publication_stage(output) as temporary:
            _write_exclusive(temporary / RESULT_NAME, result_bytes)
            race_hook("after-result-write", temporary)
            _write_exclusive(temporary / RECEIPT_NAME, canonical_json_bytes(receipt))
            race_hook("after-receipt-write", temporary)
            verify_pack(temporary, result)
            staged_identity = _directory_snapshot(temporary)
            race_hook("before-no-replace-rename", output)
        if staged_identity is None:
            raise ValueError("publication stage identity was not captured")
        with windows_directory_identity_lease(output) as published_identity:
            if published_identity != staged_identity:
                raise ValueError("published pack is not the identity-checked staged directory")
            race_hook("after-no-replace-rename", output)
            _verify_pack_contents(output, result)
            if _directory_snapshot(output) != published_identity:
                raise ValueError("published pack directory identity changed during final verification")


def _safe_output(output: Path, protected: Sequence[Path]) -> Path:
    resolved = assert_disjoint_output(output, protected)
    _verify_path_chain(resolved, "cubeface solve output", must_exist=False)
    if os.name != "nt":
        raise ValueError("cubeface solve publication requires Windows no-replace directory rename semantics")
    if resolved.drive.upper() == "C:":
        raise ValueError("cubeface solve evidence output cannot use the mutable system drive")
    if not resolved.parent.is_dir():
        raise ValueError("cubeface solve output parent must already exist and be directly verified")
    if os.path.lexists(resolved):
        raise ValueError("refusing to replace an existing cubeface solve output")
    return resolved


def _safe_existing_output(output: Path, protected: Sequence[Path]) -> Path:
    resolved = assert_disjoint_output(output, protected)
    resolved = _verify_path_chain(resolved, "cubeface solve output", must_exist=True)
    if os.name != "nt" or resolved.drive.upper() == "C:":
        raise ValueError("cubeface solve check requires an ordinary non-system local Windows drive")
    if not resolved.is_dir():
        raise ValueError("cubeface solve check output must be a directory")
    return resolved


def run(
    inputs: FrozenInputs,
    output: Path,
    reviewed_git_sha: str,
    repo_root: Path,
    *,
    check: bool,
    race_hook: RaceHook = _noop_hook,
) -> dict[str, object]:
    prepared = prepare_inputs(inputs)
    protected = [inputs.stage_root, inputs.image2d_root, inputs.crosswalk_root, inputs.camera_subset, repo_root]
    resolved_output = _safe_existing_output(output, protected) if check else _safe_output(output, protected)
    generator_paths = [
        repo_root / relative
        for relative in GENERATOR_RELATIVE_PATHS
    ]
    lease_paths = [item.path for item in prepared.source_files] + [
        face.path for row in prepared.rows for face in row.cubefaces
    ] + generator_paths
    with windows_read_leases(lease_paths):
        dependency_activation = _require_dependency_runtime_activation(repo_root)
        _verify_bound_files(prepared, include_e57_hash=True)
        race_hook("after-pre-read-custody", prepared.e57.path)
        attempts: list[dict[str, object]] = []
        attempt_hashes: list[str] = []
        for _attempt_index in range(3):
            attempt = _derive_evidence_result(
                prepared,
                reviewed_git_sha,
                repo_root,
                dependency_activation,
            )
            attempt_digest = sha256_bytes(canonical_json_bytes(attempt))
            attempts.append(attempt)
            attempt_hashes.append(attempt_digest)
            if _require_dependency_runtime_activation(repo_root) != dependency_activation:
                raise ValueError("dependency runtime attestation changed during solve attempts")
        if len(set(attempt_hashes)) != 1:
            raise ValueError("three fresh cubeface solve attempts were not byte-identical")
        result = dict(attempts[0])
        result["determinismVerification"] = {
            "attemptCount": 3,
            "attemptIsolation": "fresh_pye57_reader_same_process",
            "attemptResultSha256": attempt_hashes,
        }
        race_hook("after-e57-read", prepared.e57.path)
        _verify_bound_files(prepared, include_e57_hash=True)
        if _generator_binding(repo_root, reviewed_git_sha) != result["generator"]:
            raise ValueError("generator files changed during cubeface derivation")
        result_runtime = dict(_dict(result.get("runtime"), "result runtime"))
        del result_runtime["activation"]
        if _runtime_identity(True) != result_runtime:
            raise ValueError("numeric or native runtime identity changed during cubeface derivation")
        race_hook("after-post-read-custody", prepared.e57.path)
        resolved_output = (
            _safe_existing_output(resolved_output, protected)
            if check
            else _safe_output(resolved_output, protected)
        )
        if check:
            verify_pack(resolved_output, result)
        else:
            publish_pack(resolved_output, result, race_hook)
        _verify_bound_files(prepared, include_e57_hash=False)
        if _generator_binding(repo_root, reviewed_git_sha) != result["generator"]:
            raise ValueError("generator files changed during cubeface publication or check")
        if _require_dependency_runtime_activation(repo_root) != dependency_activation:
            raise ValueError("dependency runtime attestation changed during publication or check")
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Build/check the frozen authority-none Grand Hall E57 cubeface solve."
        )
    )
    parser.add_argument("--stage")
    parser.add_argument("--image2d-evidence-root")
    parser.add_argument("--crosswalk-root")
    parser.add_argument("--camera-subset")
    parser.add_argument("--out")
    parser.add_argument("--repo-root")
    parser.add_argument("--reviewed-git-sha")
    parser.add_argument("--check", action="store_true")
    parser.add_argument(
        "--print-runtime-attestation",
        action="store_true",
        help="print canonical read-only runtime attestation JSON and exit",
    )
    parser.add_argument("--verify-source-hashes", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.print_runtime_attestation:
        if args.repo_root is None:
            parser.error("--repo-root is mandatory for --print-runtime-attestation")
        forbidden = (
            args.stage,
            args.image2d_evidence_root,
            args.crosswalk_root,
            args.camera_subset,
            args.out,
            args.reviewed_git_sha,
        )
        if any(value is not None for value in forbidden) or args.check or args.verify_source_hashes:
            parser.error("runtime attestation mode cannot be combined with solve/check arguments")
        payload = generate_runtime_attestation(Path(args.repo_root))
        sys.stdout.buffer.write(canonical_json_bytes(payload))
        return 0
    required = {
        "--camera-subset": args.camera_subset,
        "--crosswalk-root": args.crosswalk_root,
        "--image2d-evidence-root": args.image2d_evidence_root,
        "--out": args.out,
        "--repo-root": args.repo_root,
        "--reviewed-git-sha": args.reviewed_git_sha,
        "--stage": args.stage,
    }
    missing = [name for name, value in required.items() if value is None]
    if missing:
        parser.error(f"missing mandatory solve/check arguments: {', '.join(missing)}")
    if not args.verify_source_hashes:
        parser.error("--verify-source-hashes is mandatory")
    inputs = FrozenInputs(
        Path(args.stage),
        Path(args.image2d_evidence_root),
        Path(args.crosswalk_root),
        Path(args.camera_subset),
    )
    result = run(
        inputs,
        Path(args.out),
        args.reviewed_git_sha,
        Path(args.repo_root),
        check=args.check,
    )
    print(
        "cubeface solve verified: "
        f"scans={result['summary']['scanCount']} authority=none output={Path(args.out).resolve()}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"cubeface solve failed: {error}", file=sys.stderr)
        raise SystemExit(1)
