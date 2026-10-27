import random
import unittest

import support  # noqa: F401
from ewscene import fence

SIZE = [5, 102, 54]


def parts(kind, size=SIZE, seed="fence-joint-1"):
    return [(lo, hi) for k, lo, hi in fence.picket_boxes(size, random.Random(seed)) if k == kind]


class PicketFence(unittest.TestCase):
    def test_posts_stand_at_even_steps_from_end_to_end(self):
        posts = parts("post")
        self.assertEqual(len(posts), 3)
        starts = [lo[1] for lo, _ in posts]
        self.assertAlmostEqual(starts[0], 0)
        self.assertAlmostEqual(starts[-1], SIZE[1] - fence.POST_IN)
        self.assertAlmostEqual(starts[1] - starts[0], starts[2] - starts[1])
        for lo, hi in posts:
            self.assertEqual((lo[2], hi[2]), (0, SIZE[2]))
            self.assertAlmostEqual(hi[1] - lo[1], fence.POST_IN)

    def test_every_post_wears_a_cap_at_the_top(self):
        caps = parts("cap")
        self.assertEqual(len(caps), len(parts("post")))
        for lo, hi in caps:
            self.assertEqual(hi[2], SIZE[2])
            self.assertEqual(lo[2], SIZE[2] - fence.CAP_IN)
            self.assertEqual(lo[0], -fence.CAP_OVERHANG_IN)
            self.assertEqual(hi[0], SIZE[0])

    def test_layers_run_front_to_back_posts_then_pickets_then_rails(self):
        post, picket, rail = parts("post")[0], parts("picket")[0], parts("rail")[0]
        self.assertLess(post[0][0], picket[0][0])
        self.assertAlmostEqual(picket[0][0], fence.PICKET_FRONT_IN)
        self.assertAlmostEqual(picket[1][0], fence.PICKET_BACK_IN)
        self.assertAlmostEqual(rail[0][0], picket[1][0])
        self.assertAlmostEqual(rail[1][0], fence.PICKET_BACK_IN + fence.RAIL_IN)
        self.assertLess(rail[1][0], SIZE[0])

    def test_three_rails_run_the_whole_length_at_three_heights(self):
        rails = parts("rail")
        self.assertEqual(len(rails), 3)
        for lo, hi in rails:
            self.assertEqual((lo[1], hi[1]), (0, SIZE[1]))
            self.assertAlmostEqual(hi[2] - lo[2], fence.RAIL_DEPTH_IN)
        self.assertEqual([lo[2] for lo, _ in rails], [fence.RAIL_FROM_GROUND_IN, SIZE[2] * 0.55, SIZE[2] - fence.RAIL_FROM_TOP_IN])

    def test_the_kickboard_sits_on_the_ground_in_front_of_the_pickets(self):
        (lo, hi), = parts("kickboard")
        self.assertEqual((lo[1], hi[1]), (0, SIZE[1]))
        self.assertEqual((lo[2], hi[2]), (0, fence.KICKBOARD_IN))
        self.assertEqual((lo[0], hi[0]), (fence.KICKBOARD_FRONT_IN, fence.PICKET_FRONT_IN))

    def test_pickets_leave_gaps_and_a_gap_to_the_ground(self):
        pickets = parts("picket")
        self.assertEqual(len(pickets), 18)
        for (lo, hi), (nlo, _) in zip(pickets, pickets[1:]):
            self.assertAlmostEqual(nlo[1] - hi[1], fence.PICKET_PITCH_IN - fence.PICKET_IN)
        for lo, hi in pickets:
            self.assertEqual(lo[2], fence.PICKET_FROM_GROUND_IN)
            self.assertAlmostEqual(hi[1] - lo[1], fence.PICKET_IN)
            self.assertLessEqual(hi[1], SIZE[1])
            self.assertLessEqual(hi[2], SIZE[2] - fence.PICKET_BELOW_TOP_IN)
            self.assertGreater(hi[2], SIZE[2] - fence.PICKET_BELOW_TOP_IN - fence.PICKET_TOP_JITTER_IN - 1e-9)

    def test_picket_tops_differ_but_repeat_for_the_same_seed(self):
        tops = [hi[2] for _, hi in parts("picket")]
        self.assertGreater(len(set(tops)), 10)
        self.assertEqual(tops, [hi[2] for _, hi in parts("picket")])
        self.assertNotEqual(tops, [hi[2] for _, hi in parts("picket", seed="other")])

    def test_a_short_run_still_gets_two_posts(self):
        self.assertEqual(len(parts("post", [5, 30, 54])), 2)

    def test_the_smallest_fence_is_accepted(self):
        self.assertTrue(fence.picket_boxes([4, fence.MIN_RUN_IN, fence.MIN_HEIGHT_IN], random.Random("x")))

    def test_caps_overhang_their_posts_on_every_side(self):
        for (plo, phi), (clo, chi) in zip(parts("post"), parts("cap")):
            self.assertAlmostEqual(plo[1] - clo[1], fence.CAP_OVERHANG_IN)
            self.assertAlmostEqual(chi[1] - phi[1], fence.CAP_OVERHANG_IN)
            self.assertAlmostEqual(plo[0] - clo[0], fence.CAP_OVERHANG_IN)
            self.assertAlmostEqual(phi[0], SIZE[0] - fence.CAP_OVERHANG_IN)

    def test_a_fence_too_small_is_refused(self):
        for size in ([5, 23, 54], [5, 102, 35], [3, 102, 54]):
            with self.subTest(size=size):
                with self.assertRaises(ValueError) as caught:
                    fence.picket_boxes(size, random.Random("x"))
                self.assertIn("too small", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
