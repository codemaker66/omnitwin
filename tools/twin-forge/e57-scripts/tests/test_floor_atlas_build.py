"""Auditable Floor Atlas CLI contract tests using generated local fixtures."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from argparse import Namespace

import numpy as np
from PIL import Image
from jsonschema import Draft202012Validator
import trimesh


SCRIPTS = Path(__file__).resolve().parent.parent
BUILD = SCRIPTS / "floor_atlas_build.py"
VERIFY = SCRIPTS / "verify_floor_atlas_run.py"
SCHEMA = SCRIPTS / "schemas" / "floor-atlas-run-v1.schema.json"
sys.path.insert(0, os.fspath(SCRIPTS))
import floor_atlas_build as build_module  # noqa: E402


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_digest(value: dict) -> str:
    payload = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf8")
    return hashlib.sha256(payload).hexdigest()


def _write_fixture(root: Path) -> tuple[Path, Path]:
    equirect = root / "equirect"
    equirect.mkdir()
    width, height = 128, 64
    rows, cols = np.indices((height, width))
    for index, node_id in enumerate(("scan_000", "scan_001")):
        image = np.stack(
            [
                (cols * 3 + index * 17) % 256,
                (rows * 5 + index * 11) % 256,
                ((rows + cols) * 2 + index * 7) % 256,
            ],
            axis=2,
        ).astype(np.uint8)
        Image.fromarray(image).save(equirect / f"{node_id}.jpg", quality=95)

    manifest = root / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "nodes": [
                    {
                        "id": "scan_000",
                        "pose": {"t": [-1.2, 0.0, 1.5]},
                        "floor": 0,
                    },
                    {
                        "id": "scan_001",
                        "pose": {"t": [1.2, 0.0, 1.5]},
                        "floor": 0,
                    },
                ]
            },
            indent=2,
        ),
        encoding="utf8",
    )
    return manifest, equirect


def test_build_writes_digest_bound_lossless_run_artifacts():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        manifest, equirect = _write_fixture(root)
        output = root / "out"
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                os.fspath(BUILD),
                "--manifest",
                os.fspath(manifest),
                "--equirect",
                os.fspath(equirect),
                "--out",
                os.fspath(output),
                "--bounds",
                "0",
                "0",
                "1",
                "1",
                "--mm-per-px",
                "50",
                "--z-floor",
                "0",
                "--radius-m",
                "5",
                "--max-sources",
                "2",
                "--align",
                "--harmonise",
                "--label",
                "fixture",
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert result.returncode == 0, result.stderr or result.stdout

        report_path = output / "fixture-atlas-report.json"
        report = json.loads(report_path.read_text(encoding="utf8"))
        assert report["schema_version"] == "omnitwin.floor-atlas.run.v1"
        assert report["authority"] == "none"
        assert report["provenance"] == {
            "source_truth_class": "unknown_unverified",
            "transform_class": "deterministic_multi_view_fusion",
            "transform_generated_content": False,
            "output_truth_class": "inferred_from_unverified_sources",
            "metric_use": "planning_grade_not_survey_truth",
        }
        assert report["parameters"]["align"] is True
        assert report["parameters"]["harmonise"] is True
        assert [
            item["node_id"] for item in report["alignment"]["estimates"]
        ] == ["scan_000", "scan_001"]
        assert [
            item["node_id"] for item in report["harmonisation"]["diagnostics"]
        ] == ["scan_000", "scan_001"]
        assert report["parameters"]["z_floor_m"] == {
            "requested": 0.0,
            "effective": 0.0,
            "derivation": "operator_supplied",
            "storey_z": 1.5,
        }

        manifest_record = report["inputs"]["manifest"]
        assert report["inputs"]["node_source_format"] == (
            "forged_bundle_manifest_v1"
        )
        assert manifest_record["sha256"] == _sha256(manifest)
        assert manifest_record["size_bytes"] == manifest.stat().st_size
        panoramas = report["inputs"]["panoramas"]
        assert [record["node_id"] for record in panoramas] == [
            "scan_000",
            "scan_001",
        ]
        for record in panoramas:
            source = Path(record["path"])
            assert record["sha256"] == _sha256(source)
            assert record["size_bytes"] == source.stat().st_size
            assert [record["width_px"], record["height_px"]] == [128, 64]

        counts_path = output / "fixture-counts.npy"
        counts = np.load(counts_path, allow_pickle=False)
        retained_counts_path = output / "fixture-retained-counts.npy"
        retained_counts = np.load(retained_counts_path, allow_pickle=False)
        eligible_counts_path = output / "fixture-eligible-counts.npy"
        eligible_counts = np.load(eligible_counts_path, allow_pickle=False)
        assert counts.dtype == np.uint32
        assert counts.shape == (20, 20)
        assert int(counts.max()) > 0
        assert retained_counts.dtype == np.uint32
        assert retained_counts.shape == counts.shape
        assert eligible_counts.dtype == np.uint32
        assert eligible_counts.shape == counts.shape
        assert np.all(retained_counts <= eligible_counts)
        fallback = (eligible_counts > 0) & (retained_counts == 0)
        expected_counts = retained_counts.copy()
        expected_counts[fallback] = eligible_counts[fallback]
        assert np.array_equal(counts, expected_counts)
        assert report["eligible_sample_count"] == int(eligible_counts.sum())
        assert report["retained_sample_count"] == int(retained_counts.sum())
        assert report["rejected_sample_count"] == int(
            (eligible_counts - retained_counts).sum()
        )
        assert report["fallback_px"] == int(fallback.sum())

        for record in report["outputs"].values():
            artifact = Path(record["path"])
            assert record["sha256"] == _sha256(artifact)
            assert record["size_bytes"] == artifact.stat().st_size
        assert report["outputs"]["counts"]["dtype"] == "uint32"
        assert report["outputs"]["counts"]["shape"] == [20, 20]
        assert report["outputs"]["counts"]["semantics"] == (
            "post_rejection_contributors_with_fallback_restored"
        )
        assert report["outputs"]["retained_counts"]["semantics"] == (
            "post_rejection_retained_before_fallback"
        )
        assert report["outputs"]["eligible_counts"]["semantics"] == (
            "geometrically_eligible_pre_rejection_observations"
        )

        integrity = report.pop("integrity")
        assert integrity["scope"] == "report_object_excluding_integrity"
        assert integrity["canonicalization"] == (
            "python_json_sort_keys_compact_utf8_v1"
        )
        assert integrity["payload_sha256"] == _canonical_digest(report)

        verified = subprocess.run(
            [sys.executable, "-B", os.fspath(VERIFY), os.fspath(report_path)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert verified.returncode == 0, verified.stderr or verified.stdout
        assert "PASS_FLOOR_ATLAS_RUN_INTEGRITY" in verified.stdout, (
            verified.stdout,
            verified.stderr,
        )

        def verify_mutation(name, mutate):
            variant = json.loads(report_path.read_text(encoding="utf8"))
            mutate(variant)
            variant.pop("integrity")
            variant["integrity"] = {
                "scope": "report_object_excluding_integrity",
                "canonicalization": "python_json_sort_keys_compact_utf8_v1",
                "payload_sha256": _canonical_digest(variant),
            }
            path = output / f"invalid-{name}.json"
            path.write_text(
                json.dumps(variant, indent=2, sort_keys=True) + "\n",
                encoding="utf8",
            )
            checked = subprocess.run(
                [sys.executable, "-B", os.fspath(VERIFY), os.fspath(path)],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            assert checked.returncode != 0, (name, checked.stdout, checked.stderr)

        verify_mutation(
            "mean-looks",
            lambda value: value.__setitem__(
                "mean_looks", value["mean_looks"] + 1.0
            ),
        )
        verify_mutation(
            "top-scale",
            lambda value: value.__setitem__(
                "mm_per_px", value["mm_per_px"] + 1.0
            ),
        )
        verify_mutation(
            "panorama-distance",
            lambda value: value["inputs"]["panoramas"][0].__setitem__(
                "distance_m", value["inputs"]["panoramas"][0]["distance_m"] + 0.5
            ),
        )
        verify_mutation(
            "atlas-shape",
            lambda value: value["outputs"]["atlas"].__setitem__(
                "shape", [1, 1, 3]
            ),
        )
        verify_mutation(
            "alignment-state",
            lambda value: value["alignment"]["estimates"][0].__setitem__(
                "accepted",
                not value["alignment"]["estimates"][0]["accepted"],
            ),
        )
        verify_mutation(
            "robust-sigma",
            lambda value: value["parameters"].__setitem__("robust_sigma", 9.0),
        )

        linked_schema_dir = root / "linked-schema"
        linked_schema_dir.mkdir()
        linked_schema_path = linked_schema_dir / SCHEMA.name
        linked_schema = json.loads(SCHEMA.read_text(encoding="utf8"))
        linked_schema["properties"]["room"] = {"const": "not-fixture"}
        linked_schema_path.write_text(
            json.dumps(linked_schema, indent=2) + "\n", encoding="utf8"
        )
        linked_variant = json.loads(report_path.read_text(encoding="utf8"))
        linked_variant["tool"]["run_schema"] = {
            "path": os.fspath(linked_schema_path.resolve()),
            "filename": linked_schema_path.name,
            "size_bytes": linked_schema_path.stat().st_size,
            "sha256": _sha256(linked_schema_path),
            "media_type": "application/schema+json",
        }
        linked_variant.pop("integrity")
        linked_variant["integrity"] = {
            "scope": "report_object_excluding_integrity",
            "canonicalization": "python_json_sort_keys_compact_utf8_v1",
            "payload_sha256": _canonical_digest(linked_variant),
        }
        linked_variant_path = output / "invalid-linked-schema.json"
        linked_variant_path.write_text(
            json.dumps(linked_variant, indent=2, sort_keys=True) + "\n",
            encoding="utf8",
        )
        linked_rejected = subprocess.run(
            [
                sys.executable,
                "-B",
                os.fspath(VERIFY),
                os.fspath(linked_variant_path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert linked_rejected.returncode != 0
        assert "schema validation failed" in (
            linked_rejected.stderr + linked_rejected.stdout
        )

        invalid_report = json.loads(report_path.read_text(encoding="utf8"))
        del invalid_report["room"]
        del invalid_report["integrity"]
        invalid_report["integrity"] = {
            "scope": "report_object_excluding_integrity",
            "canonicalization": "python_json_sort_keys_compact_utf8_v1",
            "payload_sha256": _canonical_digest(invalid_report),
        }
        invalid_report_path = output / "invalid-report.json"
        invalid_report_path.write_text(
            json.dumps(invalid_report, indent=2, sort_keys=True) + "\n",
            encoding="utf8",
        )
        schema_rejected = subprocess.run(
            [
                sys.executable,
                "-B",
                os.fspath(VERIFY),
                os.fspath(invalid_report_path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert schema_rejected.returncode != 0
        assert "schema validation failed" in (
            schema_rejected.stderr + schema_rejected.stdout
        )

        atlas_path = output / "fixture-atlas.png"
        with atlas_path.open("r+b") as stream:
            stream.seek(atlas_path.stat().st_size // 2)
            original = stream.read(1)
            stream.seek(-1, os.SEEK_CUR)
            stream.write(bytes([original[0] ^ 0x01]))
        rejected = subprocess.run(
            [sys.executable, "-B", os.fspath(VERIFY), os.fspath(report_path)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert rejected.returncode != 0, (rejected.stdout, rejected.stderr)
        assert "SHA-256 mismatch" in (rejected.stderr + rejected.stdout), (
            rejected.stdout,
            rejected.stderr,
        )


def test_run_schema_and_tested_requirements_are_present():
    schema = json.loads(SCHEMA.read_text(encoding="utf8"))
    Draft202012Validator.check_schema(schema)
    assert schema["properties"]["schema_version"]["const"] == (
        "omnitwin.floor-atlas.run.v1"
    )
    tested_requirements = SCRIPTS / "requirements-floor-atlas-tested.txt"
    assert tested_requirements.is_file()
    assert "numpy==" in tested_requirements.read_text(encoding="utf8")


def test_build_refuses_ambiguous_storeys_until_operator_selects_one():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        manifest, equirect = _write_fixture(root)
        data = json.loads(manifest.read_text(encoding="utf8"))
        data["nodes"][0]["floor"] = 0
        data["nodes"][0]["pose"]["t"][2] = 1.5
        data["nodes"][1]["floor"] = 1
        data["nodes"][1]["pose"]["t"][2] = 4.5
        manifest.write_text(json.dumps(data, indent=2), encoding="utf8")
        output = root / "out"
        base_command = [
            sys.executable,
            "-B",
            os.fspath(BUILD),
            "--manifest",
            os.fspath(manifest),
            "--equirect",
            os.fspath(equirect),
            "--out",
            os.fspath(output),
            "--bounds",
            "0",
            "0",
            "1",
            "1",
            "--mm-per-px",
            "50",
            "--z-floor",
            "0",
            "--radius-m",
            "5",
            "--label",
            "storey",
        ]
        refused = subprocess.run(
            base_command,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert refused.returncode != 0
        assert "ambiguous manifest floors" in (refused.stdout + refused.stderr)
        assert not (output / "storey-atlas-report.json").exists()

        accepted = subprocess.run(
            [*base_command, "--floor-id", "0"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert accepted.returncode == 0, accepted.stderr or accepted.stdout
        report = json.loads(
            (output / "storey-atlas-report.json").read_text(encoding="utf8")
        )
        assert report["sources"] == ["scan_000"]
        assert report["parameters"]["source_selection"]["method"] == (
            "manifest_floor_id+single_storey_cluster"
        )


def test_build_records_effective_mesh_occlusion_parameters():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        manifest, equirect = _write_fixture(root)
        mesh_path = root / "occluder.glb"
        mesh = trimesh.creation.box(extents=(0.2, 0.2, 0.5))
        mesh.apply_translation((0.0, 0.0, 0.25))
        mesh.export(mesh_path)
        output = root / "out"
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                os.fspath(BUILD),
                "--manifest",
                os.fspath(manifest),
                "--equirect",
                os.fspath(equirect),
                "--mesh",
                os.fspath(mesh_path),
                "--out",
                os.fspath(output),
                "--bounds",
                "0",
                "0",
                "1",
                "1",
                "--mm-per-px",
                "50",
                "--z-floor",
                "0",
                "--radius-m",
                "5",
                "--label",
                "mesh",
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert result.returncode == 0, result.stderr or result.stdout
        report_path = output / "mesh-atlas-report.json"
        report = json.loads(report_path.read_text(encoding="utf8"))
        assert report["inputs"]["mesh"]["sha256"] == _sha256(mesh_path)
        assert report["parameters"]["occlusion"] == {
            "enabled": True,
            "mesh_voxel_m": 0.1,
            "z_exempt_m": 0.3,
        }
        verified = subprocess.run(
            [sys.executable, "-B", os.fspath(VERIFY), os.fspath(report_path)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert verified.returncode == 0, verified.stderr or verified.stdout


def test_build_refuses_input_output_alias_before_writing():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        manifest, equirect = _write_fixture(root)
        output = root / "out"
        output.mkdir()
        collision_manifest = output / "collision-atlas-report.json"
        collision_manifest.write_text(
            manifest.read_text(encoding="utf8"), encoding="utf8"
        )
        before = _sha256(collision_manifest)
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                os.fspath(BUILD),
                "--manifest",
                os.fspath(collision_manifest),
                "--equirect",
                os.fspath(equirect),
                "--out",
                os.fspath(output),
                "--bounds",
                "0",
                "0",
                "1",
                "1",
                "--mm-per-px",
                "50",
                "--z-floor",
                "0",
                "--radius-m",
                "5",
                "--label",
                "collision",
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert result.returncode != 0
        assert "aliases a read-only input" in (result.stdout + result.stderr)
        assert _sha256(collision_manifest) == before
        assert not (output / "collision-atlas.png").exists()
        assert not (output / "collision-counts.npy").exists()


def test_effective_grid_remains_centred_after_pixel_rounding():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        manifest, equirect = _write_fixture(root)
        output = root / "out"
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                os.fspath(BUILD),
                "--manifest",
                os.fspath(manifest),
                "--equirect",
                os.fspath(equirect),
                "--out",
                os.fspath(output),
                "--bounds",
                "0",
                "0",
                "1.03",
                "0.97",
                "--mm-per-px",
                "60",
                "--z-floor",
                "0",
                "--radius-m",
                "5",
                "--label",
                "centred",
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert result.returncode == 0, result.stderr or result.stdout
        report_path = output / "centred-atlas-report.json"
        report = json.loads(report_path.read_text(encoding="utf8"))
        assert [report["width_px"], report["height_px"]] == [17, 16]
        assert np.allclose(report["extent_m"], [1.02, 0.96])
        origin = np.asarray(report["origin_xy"])
        extent = np.asarray(report["extent_m"])
        assert np.allclose(origin + extent / 2.0, [0.0, 0.0])
        verified = subprocess.run(
            [sys.executable, "-B", os.fspath(VERIFY), os.fspath(report_path)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert verified.returncode == 0, verified.stderr or verified.stdout


def test_source_selection_refuses_missing_floor_alias_and_chained_storeys():
    def selection_args(**overrides):
        values = {
            "radius_m": 5.0,
            "floor_id": None,
            "storey_z": None,
            "storey_tolerance_m": 0.8,
            "z_floor": 0.0,
            "max_sources": 60,
        }
        values.update(overrides)
        return Namespace(**values)

    missing_floor_nodes = {
        "scan_000": {"t": np.array([0.0, 0.0, 1.5]), "floor": None},
        "scan_001": {"t": np.array([1.0, 0.0, 1.5]), "floor": None},
    }
    try:
        build_module.select_sources(
            missing_floor_nodes, 0.0, 0.0, selection_args(floor_id="None")
        )
    except ValueError as exc:
        assert "no sweeps match --floor-id" in str(exc)
    else:
        raise AssertionError("missing floor metadata matched the string 'None'")

    chained_nodes = {
        f"scan_{index:03d}": {
            "t": np.array([float(index), 0.0, z]),
            "floor": None,
        }
        for index, z in enumerate((1.5, 2.6, 3.7))
    }
    try:
        build_module.select_sources(
            chained_nodes, 0.0, 0.0, selection_args(radius_m=10.0)
        )
    except ValueError as exc:
        assert "ambiguous scanner-height clusters" in str(exc)
    else:
        raise AssertionError("single-link height chain hid multiple storeys")


def test_verifier_rejects_rgb_without_contributor_support():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        manifest, equirect = _write_fixture(root)
        output = root / "out"
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                os.fspath(BUILD),
                "--manifest",
                os.fspath(manifest),
                "--equirect",
                os.fspath(equirect),
                "--out",
                os.fspath(output),
                "--bounds",
                "0",
                "0",
                "24",
                "24",
                "--mm-per-px",
                "1000",
                "--z-floor",
                "0",
                "--radius-m",
                "5",
                "--label",
                "unsupported",
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert result.returncode == 0, result.stderr or result.stdout
        report_path = output / "unsupported-atlas-report.json"
        report = json.loads(report_path.read_text(encoding="utf8"))
        counts = np.load(output / "unsupported-counts.npy", allow_pickle=False)
        unsupported = np.argwhere(counts == 0)
        assert unsupported.size > 0
        row, col = unsupported[0]
        atlas_path = output / "unsupported-atlas.png"
        atlas = np.asarray(Image.open(atlas_path).convert("RGB")).copy()
        atlas[row, col] = [123, 45, 67]
        Image.fromarray(atlas).save(atlas_path)
        atlas_record = report["outputs"]["atlas"]
        atlas_record["size_bytes"] = atlas_path.stat().st_size
        atlas_record["sha256"] = _sha256(atlas_path)
        report.pop("integrity")
        report["integrity"] = {
            "scope": "report_object_excluding_integrity",
            "canonicalization": "python_json_sort_keys_compact_utf8_v1",
            "payload_sha256": _canonical_digest(report),
        }
        report_path.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf8"
        )
        rejected = subprocess.run(
            [sys.executable, "-B", os.fspath(VERIFY), os.fspath(report_path)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert rejected.returncode != 0
        assert "without contributor support" in (
            rejected.stdout + rejected.stderr
        )


def test_build_accepts_and_discloses_legacy_pose_map_adapter():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        manifest, equirect = _write_fixture(root)
        manifest.write_text(
            json.dumps(
                {
                    "0": {"translation": [-1.2, 0.0, 1.5]},
                    "1": {"translation": [1.2, 0.0, 1.5]},
                },
                indent=2,
            ),
            encoding="utf8",
        )
        output = root / "out"
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                os.fspath(BUILD),
                "--manifest",
                os.fspath(manifest),
                "--equirect",
                os.fspath(equirect),
                "--out",
                os.fspath(output),
                "--bounds",
                "0",
                "0",
                "1",
                "1",
                "--mm-per-px",
                "50",
                "--z-floor",
                "0",
                "--storey-z",
                "1.5",
                "--radius-m",
                "5",
                "--label",
                "legacy",
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert result.returncode == 0, result.stderr or result.stdout
        report_path = output / "legacy-atlas-report.json"
        report = json.loads(report_path.read_text(encoding="utf8"))
        assert report["inputs"]["node_source_format"] == "legacy_pose_map_v1"
        assert report["sources"] == ["scan_000", "scan_001"]
        verified = subprocess.run(
            [sys.executable, "-B", os.fspath(VERIFY), os.fspath(report_path)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert verified.returncode == 0, verified.stderr or verified.stdout


if __name__ == "__main__":
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {test.__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    raise SystemExit(1 if failed else 0)
