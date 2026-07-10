"""Build an internal, unsigned MatterPak OBJ -> GLB reference candidate.

Run with Blender, not CPython:

    blender --background --factory-startup --python build_matterpak_glb_candidate.py -- \
      --stage <verified-stage> --out <new-working-directory>

The source stage is read-only. The script verifies the OBJ, MTL, and every
referenced texture against the capture-stage manifest, checks source/import/
GLB-roundtrip bounds, exports twice, and refuses publication unless the two
GLBs are byte-identical. It never calls Twin Forge promotion or signing code.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import sys
import tempfile
from typing import Any, Iterable

import bpy
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from e57_stage_guard import (
    StageContext,
    StageFile,
    assert_disjoint_output,
    canonical_json_sha256,
    load_stage,
    sha256_file,
    verify_stage_file,
)


REPORT_SCHEMA_VERSION = "venviewer.matterpak-glb-candidate.v1"
BOUND_TOLERANCE_M = 1e-5


def _script_args(argv: list[str]) -> list[str]:
    if "--" not in argv:
        return []
    return argv[argv.index("--") + 1 :]


def _exact_stage_file(stage: StageContext, suffix: str) -> StageFile:
    matches = [
        entry
        for entry in stage.files
        if entry.role == "vendor_control" and entry.path.suffix.lower() == suffix
    ]
    if len(matches) != 1:
        raise ValueError(f"stage must contain exactly one vendor-control {suffix} file")
    return matches[0]


def _parse_mtl_texture_names(path: Path) -> list[str]:
    texture_commands = {"map_ka", "map_kd", "map_ks", "map_bump", "bump", "disp", "decal"}
    names: list[str] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        tokens = shlex.split(line, posix=True)
        if tokens and tokens[0].lower() in texture_commands:
            if len(tokens) != 2:
                raise ValueError(
                    f"unsupported MTL texture declaration at line {line_number}; options require explicit review"
                )
            names.append(tokens[1])
    unique = sorted(set(names))
    if not unique:
        raise ValueError("MatterPak MTL does not reference any textures")
    return unique


def _texture_entries(
    stage: StageContext,
    mtl: StageFile,
    names: Iterable[str],
) -> list[StageFile]:
    by_path = {entry.path: entry for entry in stage.files}
    entries: list[StageFile] = []
    for name in names:
        if Path(name).name != name or Path(name).is_absolute():
            raise ValueError(f"MTL texture path must be a sibling filename: {name!r}")
        resolved = (mtl.path.parent / name).resolve(strict=True)
        entry = by_path.get(resolved)
        if entry is None or entry.role != "vendor_control":
            raise ValueError(f"MTL texture is not a staged vendor control: {name}")
        entries.append(entry)
    return entries


def _obj_geometry_summary(path: Path) -> dict[str, Any]:
    minimum = [float("inf"), float("inf"), float("inf")]
    maximum = [float("-inf"), float("-inf"), float("-inf")]
    vertices = 0
    faces = 0
    groups = 0
    material_libraries: list[str] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            if line.startswith("v "):
                tokens = line.split()
                if len(tokens) < 4:
                    raise ValueError(f"invalid OBJ vertex at line {line_number}")
                xyz = [float(tokens[index]) for index in range(1, 4)]
                minimum = [min(current, value) for current, value in zip(minimum, xyz)]
                maximum = [max(current, value) for current, value in zip(maximum, xyz)]
                vertices += 1
            elif line.startswith("f "):
                faces += 1
            elif line.startswith("g "):
                groups += 1
            elif line.startswith("mtllib "):
                material_libraries.append(line.split(maxsplit=1)[1].strip())
    if vertices == 0 or faces == 0:
        raise ValueError("MatterPak OBJ must contain vertices and faces")
    return {
        "vertexCount": vertices,
        "faceCount": faces,
        "groupCount": groups,
        "materialLibraries": material_libraries,
        "boundsM": {
            "minimum": minimum,
            "maximum": maximum,
            "span": [high - low for low, high in zip(minimum, maximum)],
        },
    }


def _clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def _scene_bounds() -> tuple[list[float], list[float], int]:
    meshes = [item for item in bpy.context.scene.objects if item.type == "MESH"]
    if not meshes:
        raise ValueError("Blender scene contains no imported mesh objects")
    points = [item.matrix_world @ Vector(corner) for item in meshes for corner in item.bound_box]
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return minimum, maximum, len(meshes)


def _material_texture_summary() -> tuple[int, int]:
    materials = {
        material
        for item in bpy.context.scene.objects
        if item.type == "MESH"
        for material in item.data.materials
        if material is not None
    }
    images: set[str] = set()
    for material in materials:
        if material.node_tree is None:
            continue
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image is not None:
                images.add(str(Path(bpy.path.abspath(node.image.filepath)).resolve(strict=False)))
    return len(materials), len(images)


def _assert_bounds(
    expected: dict[str, Any],
    actual_minimum: list[float],
    actual_maximum: list[float],
    label: str,
) -> float:
    expected_minimum = expected["minimum"]
    expected_maximum = expected["maximum"]
    delta = max(
        abs(a - b)
        for a, b in zip(expected_minimum + expected_maximum, actual_minimum + actual_maximum)
    )
    if delta > BOUND_TOLERANCE_M:
        raise ValueError(
            f"{label} bounds diverge from source OBJ by {delta} m (limit {BOUND_TOLERANCE_M} m)"
        )
    return delta


def _export_glb(path: Path) -> None:
    result = bpy.ops.export_scene.gltf(
        filepath=str(path),
        check_existing=False,
        export_format="GLB",
        export_yup=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_keep_originals=False,
        use_selection=False,
        use_visible=False,
        use_renderable=False,
    )
    if result != {"FINISHED"} or not path.is_file() or path.stat().st_size <= 0:
        raise ValueError(f"Blender GLB export failed: {result}")


def _write_json(path: Path, value: Any) -> None:
    content = json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", required=True, help="verified capture stage root")
    parser.add_argument("--out", required=True, help="new, disjoint candidate directory")
    args = parser.parse_args(argv)

    stage = load_stage(Path(args.stage))
    output = assert_disjoint_output(Path(args.out), [stage.root])
    if output.exists():
        raise ValueError(f"refusing to replace an existing candidate directory: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    obj = _exact_stage_file(stage, ".obj")
    mtl = _exact_stage_file(stage, ".mtl")
    obj_summary = _obj_geometry_summary(obj.path)
    if obj_summary["materialLibraries"] != [mtl.path.name]:
        raise ValueError(
            f"OBJ material library must resolve exactly to staged MTL {mtl.path.name!r}"
        )
    textures = _texture_entries(stage, mtl, _parse_mtl_texture_names(mtl.path))
    for entry in [obj, mtl, *textures]:
        verify_stage_file(entry)

    temporary = Path(tempfile.mkdtemp(prefix=f".{output.name}.stage-", dir=output.parent))
    try:
        _clear_scene()
        imported = bpy.ops.wm.obj_import(
            filepath=str(obj.path),
            forward_axis="Y",
            up_axis="Z",
            global_scale=1.0,
            clamp_size=0.0,
            use_split_objects=False,
            use_split_groups=False,
            validate_meshes=True,
        )
        if imported != {"FINISHED"}:
            raise ValueError(f"Blender OBJ import failed: {imported}")
        imported_minimum, imported_maximum, imported_mesh_count = _scene_bounds()
        import_delta = _assert_bounds(
            obj_summary["boundsM"], imported_minimum, imported_maximum, "Blender import"
        )
        imported_material_count, imported_texture_count = _material_texture_summary()
        if imported_material_count < len(textures) or imported_texture_count != len(textures):
            raise ValueError(
                "Blender did not bind every staged diffuse texture: "
                f"materials={imported_material_count}, images={imported_texture_count}, "
                f"expected={len(textures)}"
            )

        first = temporary / "matterpak-reference.glb"
        second = temporary / "matterpak-reference-repeat.glb"
        _export_glb(first)
        _export_glb(second)
        first_hash = sha256_file(first)
        second_hash = sha256_file(second)
        if first_hash != second_hash or first.stat().st_size != second.stat().st_size:
            raise ValueError(
                "Blender export is not byte-deterministic across two identical exports; candidate rejected"
            )
        second.unlink()

        _clear_scene()
        roundtrip = bpy.ops.import_scene.gltf(filepath=str(first))
        if roundtrip != {"FINISHED"}:
            raise ValueError(f"Blender GLB roundtrip import failed: {roundtrip}")
        roundtrip_minimum, roundtrip_maximum, roundtrip_mesh_count = _scene_bounds()
        roundtrip_delta = _assert_bounds(
            obj_summary["boundsM"], roundtrip_minimum, roundtrip_maximum, "GLB roundtrip"
        )

        report = {
            "schemaVersion": REPORT_SCHEMA_VERSION,
            "captureStage": {
                "root": str(stage.root),
                "planSha256": stage.plan_sha256,
                "manifestSha256": sha256_file(stage.manifest_path),
            },
            "reconstructionStrategy": "matterpak_original",
            "source": {
                "obj": {
                    "targetRelativePath": obj.target_relative_path,
                    "sizeBytes": obj.size_bytes,
                    "sha256": obj.sha256,
                },
                "mtl": {
                    "targetRelativePath": mtl.target_relative_path,
                    "sizeBytes": mtl.size_bytes,
                    "sha256": mtl.sha256,
                },
                "textureCount": len(textures),
                "textureSetSha256": canonical_json_sha256(
                    [
                        {
                            "targetRelativePath": entry.target_relative_path,
                            "sizeBytes": entry.size_bytes,
                            "sha256": entry.sha256,
                        }
                        for entry in textures
                    ]
                ),
                "geometry": obj_summary,
            },
            "converter": {
                "name": "Blender",
                "version": bpy.app.version_string,
                "objImport": {
                    "forwardAxis": "Y",
                    "upAxis": "Z",
                    "globalScale": 1.0,
                },
                "gltfExport": {"format": "GLB", "exportYup": True},
            },
            "verification": {
                "allReferencedStageFilesSha256Verified": True,
                "byteDeterministicAcrossTwoExports": True,
                "importedMeshCount": imported_mesh_count,
                "importedMaterialCount": imported_material_count,
                "importedDiffuseTextureCount": imported_texture_count,
                "roundtripMeshCount": roundtrip_mesh_count,
                "sourceToImportMaxBoundsDeltaM": import_delta,
                "sourceToRoundtripMaxBoundsDeltaM": roundtrip_delta,
                "boundsToleranceM": BOUND_TOLERANCE_M,
            },
            "artifact": {
                "relativePath": first.name,
                "sizeBytes": first.stat().st_size,
                "sha256": first_hash,
            },
            "authority": {
                "status": "vendor_control_candidate",
                "geometryClaim": "MatterPak reference/fallback only; not an E57 deterministic room-shell result.",
                "transformArtifactStatus": "not_registered",
                "qaStatus": "not_reviewed",
                "signatureStatus": "unsigned",
                "publicExposure": "blocked",
            },
            "limitations": [
                "Byte determinism and bounding-box preservation do not establish point-to-mesh alignment residuals.",
                "The vendor OBJ is not the D-024 default E57 geometry authority.",
                "No TransformArtifactV0, signed AssetVersion, visual QA approval, or runtime promotion is created.",
            ],
        }
        _write_json(temporary / "candidate-evidence.json", report)
        os.replace(temporary, output)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    print(
        "MatterPak GLB candidate complete: "
        f"{report['artifact']['sizeBytes']} bytes, SHA-256 {report['artifact']['sha256']}, output {output}"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(_script_args(sys.argv)))
    except Exception as error:
        print(f"MatterPak GLB candidate failed: {error}", file=sys.stderr)
        sys.exit(1)
