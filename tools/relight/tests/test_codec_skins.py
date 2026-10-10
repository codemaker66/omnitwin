import unittest
import numpy as np
from relight import codec


class Skins(unittest.TestCase):
    def test_cover_flags_make_interior_splats_class_7_in_their_group(self):
        f = np.array([0, codec.FLAG_ISO | codec.FLAG_SUN, codec.CLASS_EMBRASURE, codec.CLASS_CH_EMITTER | codec.FLAG_CH_CENTRE], np.uint8)
        out = codec.cover_flags(f, np.array([4, 6, 1, 2]))
        self.assertEqual(int(out[0]), 7 | (4 << 5))
        self.assertEqual(int(out[1]), 7 | codec.FLAG_ISO | codec.FLAG_SUN | (6 << 5))
        self.assertEqual(out[2:].tolist(), f[2:].tolist())
        self.assertEqual(codec.skin_group_of(out).tolist(), [4, 6, -1, -1])
        self.assertLess(int(out.max()), 0xff)
        with self.assertRaises(ValueError):
            codec.cover_flags(f, 7)

    def test_toggles_keep_class_and_flags_and_skip_covered_splats(self):
        f = np.array([0, codec.CLASS_CH_EMITTER | codec.FLAG_CH_CENTRE, 7 | (2 << 5)], np.uint8)
        out = codec.toggle_flags(f, 2)
        self.assertEqual(int(out[0]), 2 << 6)
        self.assertEqual(int(out[1]) & 0b0011_1111, int(f[1]))
        self.assertEqual(int(out[2]), int(f[2]))
        self.assertEqual(codec.toggle_of(out).tolist(), [2, 2, 0])


if __name__ == "__main__":
    unittest.main()
