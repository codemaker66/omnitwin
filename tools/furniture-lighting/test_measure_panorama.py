import unittest
import numpy as np
from measure_panorama import basis, irradiance, linear


class PanoramaLightingMath(unittest.TestCase):
    def test_full_sphere_constant_radiance_has_pi_irradiance(self):
        width, height = 256, 128
        u, v = np.meshgrid((np.arange(width)+.5)/width, (np.arange(height)+.5)/height)
        lon, lat = 2*np.pi*u, (.5-v)*np.pi
        rays = np.stack([np.cos(lat)*np.cos(lon), np.sin(lat), np.cos(lat)*np.sin(lon)], axis=-1).reshape(-1, 3)
        edges = np.arange(height+1)/height*np.pi
        weights = np.repeat((np.cos(edges[:-1])-np.cos(edges[1:]))*2*np.pi/width, width)
        self.assertAlmostEqual(weights.sum(), 4*np.pi, places=12)
        coefficients = basis(rays).T @ (np.ones((len(rays), 3))*weights[:, None])
        normals = np.concatenate([np.eye(3), -np.eye(3)])
        np.testing.assert_allclose(irradiance(coefficients, normals), np.pi, atol=.0002)

    def test_inverse_srgb_is_explicit_and_not_an_hdr_exposure_claim(self):
        np.testing.assert_allclose(linear(np.array([0., .04045, .5, 1.])),
                                   [0., .00313080495, .21404114048, 1.], atol=1e-10)


if __name__ == '__main__':
    unittest.main()
