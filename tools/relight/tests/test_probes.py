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
    """Task 4d (amended 11 October): both grids cover the probes' lookup box, whose top is the proof's 9.8 m."""

    def test_the_grid_runs_from_the_low_corner_to_the_first_plane_at_or_above_the_top(self):
        P, shape, origin = probes.box_grid(HALL, 0.5, top=1.8)
        self.assertEqual(tuple(int(v) for v in shape), (5, 3, 5))     # z 0, 0.5, .., 2.0: the first plane at or above 1.8
        self.assertEqual(P.shape, (75, 3))
        np.testing.assert_array_equal(origin, [0.0, 0.0, 0.0])
        self.assertEqual(float(P[:, 2].max()), 2.0)
        _P, on_top, _o = probes.box_grid(HALL, 0.5, top=2.0)        # a plane on the top itself is enough
        self.assertEqual(tuple(int(v) for v in on_top), (5, 3, 5))

    def test_x_and_y_keep_the_coarse_grids_planes_and_its_probes_are_the_first_z_planes(self):
        P, shape, origin = probes.box_grid(HALL, 0.5, top=1.8)
        Pc, shape_c, origin_c = probes.coarse_grid(HALL, 0.5)
        self.assertEqual(tuple(shape[:2]), tuple(shape_c[:2]))
        np.testing.assert_array_equal(origin, origin_c)
        first = P.reshape(tuple(int(v) for v in shape) + (3,))[:, :, :int(shape_c[2])].reshape(-1, 3)
        np.testing.assert_array_equal(first, Pc)                  # the same positions, bit for bit

    def test_every_probe_inside_the_walls_and_on_or_above_the_floor_is_valid(self):
        P = np.array([[0.0, 0.5, 0.5],      # on the low x wall
                      [2.0, 1.0, 0.0],      # on the far corner, on the floor
                      [1.0, 0.0, 3.0],      # on the low y wall, far above the ceiling
                      [1.0, 0.5, -0.01],    # under the floor
                      [2.01, 0.5, 0.5],     # beyond the far x wall
                      [1.0, -0.01, 0.5]])   # beyond the low y wall
        self.assertEqual(probes.box_valid(P, HALL).tolist(), [True, True, True, False, False, False])

    def test_the_halls_grids_cover_the_proofs_kept_range_and_every_probe_is_valid(self):
        for spacing, want in ((0.5, (43, 22, 21)), (1.0, (22, 11, 11))):
            P, shape, origin = probes.box_grid(HALL_E57, spacing, top=9.8)
            self.assertEqual(tuple(int(v) for v in shape), want)
            np.testing.assert_array_equal(origin, [-1.823, -10.329, 0.02])
            valid = probes.box_valid(P, HALL_E57)
            self.assertTrue(bool(valid.all()))
            self.assertLessEqual(float(P[valid, 2].min()), 0.1)      # the proof keeps probes from 0.1 m ..
            self.assertGreaterEqual(float(P[valid, 2].max()), 9.9)   # .. to 9.9 m


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
