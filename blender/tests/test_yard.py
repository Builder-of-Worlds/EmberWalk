import os
import unittest

import support
from ewscene import grass_plot as yard

SPEC = support.load_json(os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-before", "spec.json"))
IN = 0.0254


class Keepouts(unittest.TestCase):
    def setUp(self):
        self.keep = yard.keepouts(SPEC)

    def test_grass_stays_off_the_house_the_porch_and_the_driveway(self):
        for name, x_in, y_in in (("house", 300, 500), ("garage", 100, 100), ("porch", 500, 250), ("driveway", 180, -600)):
            with self.subTest(name):
                self.assertTrue(yard.blocked(self.keep, x_in * IN, y_in * IN))

    def test_grass_stays_off_the_front_walk(self):
        a, b = SPEC["look"]["front_yard"]["walk"]["from_in"], SPEC["look"]["front_yard"]["walk"]["to_in"]
        self.assertTrue(yard.blocked(self.keep, (a[0] + b[0]) / 2 * IN, (a[1] + b[1]) / 2 * IN))

    def test_grass_grows_on_the_open_yard_and_over_the_road_edge_is_not_kept_off(self):
        self.assertFalse(yard.blocked(self.keep, -300 * IN, 400 * IN))
        self.assertFalse(yard.blocked(self.keep, 900 * IN, 400 * IN))
        self.assertFalse(yard.blocked(self.keep, 800 * IN, -1450 * IN))


class Thickness(unittest.TestCase):
    def test_no_patch_is_bare_and_the_deepest_is_full(self):
        self.assertEqual(yard.thickness(0.0), yard.THIN)
        self.assertEqual(yard.thickness(1.0), 1.0)

    def test_thicker_patches_never_hold_less_grass(self):
        values = [yard.thickness(v / 100.0) for v in range(101)]
        self.assertEqual(values, sorted(values))


class Lens(unittest.TestCase):
    def test_the_grid_holds_the_whole_walk_192_in_back(self):
        x0, x1, y0, y1 = yard.GRID_M
        self.assertLess(x0, -192 * IN)
        self.assertGreater(x1, (720 + 192) * IN)
        self.assertLess(y0, -192 * IN)
        self.assertGreater(y1, (780 + 192) * IN)


if __name__ == "__main__":
    unittest.main()
