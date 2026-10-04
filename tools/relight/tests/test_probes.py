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
