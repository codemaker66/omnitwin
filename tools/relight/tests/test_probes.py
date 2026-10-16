import unittest
import numpy as np
from relight import probes

HALL = {"x0": 0.0, "x1": 2.0, "y0": 0.0, "y1": 1.0, "floorZ": 0.0, "ceilingZ": 1.0}


class Grid(unittest.TestCase):
    def test_coarse_grid_covers_the_hall_at_the_spacing(self):
        P, shape, origin = probes.coarse_grid(HALL, 0.5)
        self.assertEqual(tuple(shape), (5, 3, 3))
        self.assertEqual(P.shape, (45, 3))
        self.assertTrue(np.allclose(origin, [0.0, 0.0, 0.0]))

    def test_probes_outside_the_hall_are_invalid(self):
        P = np.array([[1.0, 0.5, 0.5], [3.0, 0.5, 0.5], [1.0, 0.5, -0.2]])
        self.assertEqual(probes.valid_mask(P, HALL, inset=0.01).tolist(), [True, False, False])


HALL_E57 = {"x0": -1.823, "x1": 19.307, "y0": -10.329, "y1": 0.301, "floorZ": 0.02, "ceilingZ": 6.78}   # config/grand-hall.json


class BoxGrid(unittest.TestCase):
    """Task 4d: both grids cover the probes' lookup box, whose top is the proof's 9.8 m (amended 11 October), with their
    planes off the surfaces (variant B, the ruling of 13 October): x and y centred between the walls at the base
    spacing, z from the proof's lowest kept plane."""

    def test_the_grid_runs_from_the_proofs_plane_to_the_first_plane_at_or_above_the_top(self):
        P, shape, origin = probes.box_grid(HALL, 0.5, top=1.8, base=0.5)
        self.assertEqual(tuple(int(v) for v in shape), (5, 3, 5))     # z 0.1, 0.6, .., 2.1: the first plane at or above 1.8
        self.assertEqual(P.shape, (75, 3))
        np.testing.assert_array_equal(origin, [0.0, 0.0, 0.1])       # 2 m and 1 m are whole steps: no margin in x and y
        self.assertAlmostEqual(float(P[:, 2].max()), 2.1, places=12)
        _P, on_top, _o = probes.box_grid(HALL, 0.5, top=2.1, base=0.5)   # a plane on the top itself is enough
        self.assertEqual(tuple(int(v) for v in on_top), (5, 3, 5))

    def test_x_and_y_are_centred_between_the_walls_at_the_base_spacing(self):
        hall = {**HALL, "x1": 2.3, "y1": 1.1}                         # 0.3 m and 0.1 m over whole 0.5 m steps
        P, shape, origin = probes.box_grid(hall, 0.5, top=1.8, base=0.5)
        self.assertEqual(tuple(int(v) for v in shape[:2]), (5, 3))
        np.testing.assert_allclose(origin, [0.15, 0.05, 0.1], atol=1e-12)
        np.testing.assert_allclose(P[:, 0].max(), 2.15, atol=1e-12)   # 0.15 m from the far x wall too
        np.testing.assert_allclose(P[:, 1].max(), 1.05, atol=1e-12)

    def test_the_coarser_grid_lies_on_the_base_grids_even_planes(self):
        P05, shape05, origin05 = probes.box_grid(HALL_E57, 0.5, top=9.8, base=0.5)
        P1, shape1, origin1 = probes.box_grid(HALL_E57, 1.0, top=9.8, base=0.5)
        np.testing.assert_array_equal(origin1, origin05)
        fine = P05.reshape(tuple(int(v) for v in shape05) + (3,))
        coarse = P1.reshape(tuple(int(v) for v in shape1) + (3,))
        np.testing.assert_array_equal(coarse, fine[::2, ::2, ::2][:shape1[0], :shape1[1], :shape1[2]])   # bit for bit

    def test_a_floor_at_or_above_the_proofs_plane_is_refused(self):
        with self.assertRaises(ValueError):
            probes.box_grid({**HALL, "floorZ": 0.1}, 0.5, top=1.8, base=0.5)

    def test_every_probe_inside_the_walls_and_on_or_above_the_floor_is_valid(self):
        P = np.array([[0.0, 0.5, 0.5],      # on the low x wall
                      [2.0, 1.0, 0.0],      # on the far corner, on the floor
                      [1.0, 0.0, 3.0],      # on the low y wall, far above the ceiling
                      [1.0, 0.5, -0.01],    # under the floor
                      [2.01, 0.5, 0.5],     # beyond the far x wall
                      [1.0, -0.01, 0.5]])   # beyond the low y wall
        self.assertEqual(probes.box_valid(P, HALL).tolist(), [True, True, True, False, False, False])

    def test_the_halls_grids_cover_the_proofs_kept_range_off_every_surface_and_every_probe_is_valid(self):
        h = HALL_E57
        for spacing, want in ((0.5, (43, 22, 21)), (1.0, (22, 11, 11))):
            P, shape, origin = probes.box_grid(h, spacing, top=9.8, base=0.5)
            self.assertEqual(tuple(int(v) for v in shape), want)
            np.testing.assert_allclose(origin, [-1.758, -10.264, 0.1], atol=1e-9)   # task-4d-report.md, variant B
            valid = probes.box_valid(P, h)
            self.assertTrue(bool(valid.all()))
            self.assertAlmostEqual(float(P[:, 2].min()), 0.1, places=12)            # the proof keeps probes from 0.1 m ..
            self.assertGreaterEqual(float(P[:, 2].max()), 9.9)                      # .. to 9.9 m
            gaps = [P[:, 0].min() - h["x0"], h["x1"] - P[:, 0].max(), P[:, 1].min() - h["y0"], h["y1"] - P[:, 1].max()]
            self.assertGreaterEqual(min(gaps), 0.065 - 1e-9)                        # no probe on or by a wall ..
            self.assertGreaterEqual(float(P[:, 2].min()) - h["floorZ"], 0.08 - 1e-9)   # .. or on the floor


class PatchDirect(unittest.TestCase):
    def test_windows_combine_their_four_bands(self):
        n = 2
        patches = {"E_win": np.ones((n, 20), np.float32), "E_cove": np.full(n, 2.0), "E_ch": np.full((n, 2), 3.0), "E_dome": np.full(n, 4.0)}
        d = probes.patch_direct_by_source(patches, np.array([0.15, 0.66, 1.0, 1.21]))
        self.assertEqual(d.shape, (2, 9))
        self.assertAlmostEqual(float(d[0, 0]), 3.02, places=5)
        self.assertEqual(d[0, 5:].tolist(), [2.0, 3.0, 3.0, 4.0])


class Luminance(unittest.TestCase):
    def test_cube_luminance_is_the_faces_mean_weighted_by_channel(self):
        cubes = np.zeros((2, 3, 6))
        cubes[0, 1, :] = 6.0                     # green, every face
        cubes[1, 0, 4] = 6.0                     # red, the +z face only
        np.testing.assert_allclose(probes.cube_luminance(cubes, [0.2, 0.7, 0.1]), [4.2, 0.2], rtol=0, atol=1e-12)


if __name__ == "__main__":
    unittest.main()
