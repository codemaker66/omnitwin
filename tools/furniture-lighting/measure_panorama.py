"""LDR panorama lighting hypothesis; source masters are opened read-only.

Not radiometric calibration: inverse sRGB is assumed, JPEG tone mapping and
capture-time differences remain. Candidate registrations retain no authority.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def linear(rgb):
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def basis(v):
    x, y, z = v.T
    return np.column_stack([np.full(len(x), .282095), .488603*y, .488603*z,
                            .488603*x, 1.092548*x*y, 1.092548*y*z,
                            .315392*(3*z*z-1), 1.092548*x*z,
                            .546274*(x*x-y*y)])


def irradiance(coefficients, v):
    x, y, z = v.T
    b = np.column_stack([np.full(len(x), .886227), 1.023328*y, 1.023328*z,
                         1.023328*x, .858086*x*y, .858086*y*z,
                         .743125*z*z-.247708, .858086*x*z,
                         .429043*(x*x-y*y)])
    return b @ coefficients


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def measure(panorama, rig_path, mesh_fit_path):
    original_hash = sha(panorama)
    rig = json.loads(rig_path.read_text())
    pair = next(p for p in rig['pairs'] if p['sweep_number'] == 41)
    fit = json.loads(mesh_fit_path.read_text())['candidates'][0]
    rzup_to_yup = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0.]])
    e57_to_target = np.array(fit['source_native_to_target_native_row_major'])[:3, :3]
    e57_to_served = rzup_to_yup @ e57_to_target
    e57_from_panorama = np.array(pair['candidate_rotation_e57_from_panorama_cv'])
    rotation = e57_to_served @ e57_from_panorama
    assert np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-6)
    assert np.isclose(np.linalg.det(rotation), 1, atol=1e-6)
    with Image.open(panorama) as image:
        native_size = image.size
        rgb = linear(np.asarray(image.convert('RGB').resize((1024, 512), Image.Resampling.BOX)) / 255.)
    height, width = rgb.shape[:2]
    u, v = np.meshgrid((np.arange(width)+.5)/width, (np.arange(height)+.5)/height)
    lon, lat = u*2*np.pi, (.5-v)*np.pi
    rays = np.stack([np.cos(lat)*np.sin(lon), -np.sin(lat), np.cos(lat)*np.cos(lon)], axis=-1)
    rays = rays.reshape(-1, 3) @ rotation.T
    rgb = rgb.reshape(-1, 3)
    row_edges = np.arange(height+1)/height*np.pi
    weights = np.repeat((np.cos(row_edges[:-1])-np.cos(row_edges[1:]))*2*np.pi/width, width)
    supported = (v.ravel() >= 58/1024) & (v.ravel() < 1-140/1024)
    weights *= supported
    luminance_weights = np.array([.2126, .7152, .0722])
    lum = rgb @ luminance_weights
    upper = supported & (rays[:, 1] > .25)
    threshold = float(np.percentile(lum[upper], 90))
    # The bright upper region contains both fixtures and lit architectural
    # surfaces. Collapse its excess into one directional presentation lobe.
    excess = np.maximum(rgb-threshold, 0) * upper[:, None]
    energy = (excess * weights[:, None]).sum(axis=0)
    direction = ((excess @ luminance_weights * weights)[:, None] * rays).sum(axis=0)
    direction /= np.linalg.norm(direction)
    residual_coefficients = basis(rays).T @ ((rgb-excess)*weights[:, None])
    up = np.array([[0., 1., 0.]])
    upward = irradiance(residual_coefficients, up)[0] + energy*direction[1]
    # Keep the baseline polygon rig's upward-facing diffuse luminance. This is
    # a renderer exposure convention, not the physical exposure of the source.
    baseline_up = linear(np.array([240, 240, 255])/255.)*1.2 + .3
    gain = float((baseline_up @ luminance_weights)/(upward @ luminance_weights))
    residual_coefficients *= gain
    energy *= gain
    sample = rays[::53]
    residual_min = float(irradiance(residual_coefficients, sample).min())
    if residual_min < 0:
        raise ValueError('Probe produces negative sampled diffuse irradiance')
    rois = {
        'window_blue_sky': [.886, .187, .955, .370],
        'near_chandelier': [.502, .210, .583, .326],
        'ceiling_paint': [.403, .145, .474, .269],
        'floor': [.387, .619, .661, .787],
        'wood_panelling': [.230, .500, .287, .645],
    }
    regions = {}
    for name, (left, top, right, bottom) in rois.items():
        mask = (u.ravel() >= left) & (u.ravel() < right) & (v.ravel() >= top) & (v.ravel() < bottom)
        centroid = (rays[mask]*weights[mask, None]).sum(axis=0)
        centroid /= np.linalg.norm(centroid)
        regions[name] = {'uv_rectangle': rois[name], 'mean_linear_luminance': float(lum[mask].mean()),
                         'p95_linear_luminance': float(np.percentile(lum[mask], 95)),
                         'candidate_served_direction': centroid.tolist()}
    result = {
        'schema': 'venviewer.furniture-lighting-hypothesis.v1',
        'source': panorama.name, 'source_sha256': original_hash, 'native_size': native_size,
        'analysis_size': [width, height], 'authority': 'presentation-experiment-only',
        'accepted_registration': False, 'radiometrically_calibrated': False,
        'source_view': 'blue evening window sky; illuminated chandeliers and ceiling wash',
        'excluded_polar_rows_fraction': [58/1024, 140/1024],
        'represented_solid_angle_fraction': float(weights.sum()/(4*np.pi)),
        'rig_report_sha256': sha(rig_path), 'mesh_fit_report_sha256': sha(mesh_fit_path),
        'bearing_convention': 'u,v are normalized pixel centres; lon=2pi*u, lat=pi/2-pi*v; panorama CV ray=[cos(lat)*sin(lon),-sin(lat),cos(lat)*cos(lon)]',
        'transform_composition': 'served_from_panorama = target_zup_to_served_yup * candidate_target_from_e57 * candidate_e57_from_panorama; directions use rotation only, no translation',
        'target_zup_to_served_yup_rotation': rzup_to_yup.tolist(),
        'candidate_target_from_e57_rotation': e57_to_target.tolist(),
        'candidate_e57_from_panorama_rotation': e57_from_panorama.tolist(),
        'candidate_served_from_e57_rotation': e57_to_served.tolist(),
        'candidate_served_from_panorama_rotation': rotation.tolist(),
        'upper_excess_threshold_linear': threshold, 'source_exposure_gain': gain,
        'diffuse_sh_rgb': residual_coefficients.tolist(),
        'key_direction_to_light': direction.tolist(), 'key_linear_rgb_irradiance': energy.tolist(),
        'upward_reference_luminance': float(baseline_up @ luminance_weights),
        'upward_candidate_luminance': float((irradiance(residual_coefficients, up)[0]+energy*direction[1]) @ luminance_weights),
        'sampled_min_residual_irradiance': residual_min, 'regions': regions,
        'limits': ['LDR JPEG tone mapping and white balance are unknown; no lux, HDR or calibrated exposure claim.',
                   'Panorama-to-E57 and Matterport-to-served rotations are diagnostic candidates, not accepted registrations.',
                   'One distant key approximates distributed upper emitters; its shadows are presentation lighting.',
                   'No floor receiver, source recoloring, global renderer exposure or Spark material change.',
                   'The diffuse probe has no glossy environment reflections.'],
    }
    assert sha(panorama) == original_hash
    assert abs(result['upward_reference_luminance']-result['upward_candidate_luminance']) < 1e-10
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--panorama', type=Path, required=True)
    parser.add_argument('--rig-report', type=Path, required=True)
    parser.add_argument('--mesh-fit', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--typescript-output', type=Path)
    args = parser.parse_args()
    result = measure(args.panorama, args.rig_report, args.mesh_fit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2)+'\n')
    if args.typescript_output is not None:
        args.typescript_output.parent.mkdir(parents=True, exist_ok=True)
        args.typescript_output.write_text('// Generated by tools/furniture-lighting/measure_panorama.py.\n'
                                          '// Source-linked presentation hypothesis, not calibrated illumination.\n'
                                          'export const GRAND_HALL_FURNITURE_LIGHTING_PROBE = '
                                          + json.dumps(result, indent=2)+' as const;\n')
    print(json.dumps({k: result[k] for k in ['source_sha256', 'key_direction_to_light',
                      'key_linear_rgb_irradiance', 'source_exposure_gain', 'regions']}))
