import unittest
import numpy as np
from relight import floorlight

# A 0.2 x 0.1 m skin of 2 mm texels whose columns run along +y and rows along -x, on the plane z = 3 (capture frame).
SKIN = {"grid": {"widthPx": 100, "heightPx": 50, "texelM": 0.002, "origin": [1.0, 2.0, 3.0],
                 "uAxis": [0.0, 0.002, 0.0], "vAxis": [-0.002, 0.0, 0.0]},
        "plane": {"normal": [0.0, 0.0, 1.0], "d": 3.0}}
# capture = T @ model: a quarter turn about z, then a shift
T = np.array([[0.0, -1.0, 0.0, 5.0], [1.0, 0.0, 0.0, -1.0], [0.0, 0.0, 1.0, 0.5], [0.0, 0.0, 0.0, 1.0]])


def to_model(p):
    return (np.asarray(p, np.float64) - T[:3, 3]) @ T[:3, :3]          # as common.json_to_e57


class FloorGrid(unittest.TestCase):
    def test_the_light_maps_cover_the_skins_grid_at_their_texel(self):
        self.assertEqual(floorlight.floor_grid(SKIN, 0.05), {"w": 4, "h": 2, "width": 0.2, "height": 0.1})

    def test_texel_centres_follow_the_skins_axes_with_row_0_first(self):
        C = floorlight.capture_centres(SKIN, floorlight.floor_grid(SKIN, 0.05))
        self.assertEqual(C.shape, (2, 4, 3))
        np.testing.assert_allclose(C[0, 0], [1.0 - 0.025, 2.0 + 0.025, 3.0], rtol=0, atol=1e-12)   # 12.5 skin texels in
        np.testing.assert_allclose(C[1, 3], [1.0 - 0.075, 2.0 + 0.175, 3.0], rtol=0, atol=1e-12)   # (3, 1): 87.5 and 37.5

    def test_texel_to_model_maps_each_texel_centre_lifted_off_the_plane(self):
        C = floorlight.capture_centres(SKIN, floorlight.floor_grid(SKIN, 0.05))
        P = floorlight.lift_to_plane(to_model(C), floorlight.model_plane(SKIN, T), 0.02)
        np.testing.assert_allclose(P[..., 2], 2.52, rtol=0, atol=1e-12)                   # z = 3 - 0.5, plus 2 cm
        M = floorlight.texel_to_model(P)
        self.assertEqual(M.shape, (4, 4))
        for row, col in ((0, 0), (1, 3), (0, 2)):
            np.testing.assert_allclose(M @ [col, row, 0.0, 1.0], [*P[row, col], 1.0], rtol=0, atol=1e-12)
        np.testing.assert_array_equal(M[3], [0.0, 0.0, 0.0, 1.0])

    def test_a_tilted_plane_sets_each_points_height(self):
        skin = {**SKIN, "plane": {"normal": [0.0, 0.6, 0.8], "d": 4.0}}        # z = (4 - 0.6 y) / 0.8 at T = identity
        P = floorlight.lift_to_plane(np.array([[0.0, 0.0, 9.0], [1.0, 2.0, -9.0]]), floorlight.model_plane(skin, np.eye(4)), 0.02)
        np.testing.assert_allclose(P, [[0.0, 0.0, 5.02], [1.0, 2.0, 3.52]], rtol=0, atol=1e-12)

    def test_texel_to_model_refuses_points_off_an_affine_grid(self):
        P = np.zeros((2, 3, 3))
        P[..., 0] = np.arange(3)[None, :]
        P[1, 2, 2] = 0.01                                                        # one point 1 cm off the plane
        with self.assertRaises(ValueError):
            floorlight.texel_to_model(P)


if __name__ == "__main__":
    unittest.main()
