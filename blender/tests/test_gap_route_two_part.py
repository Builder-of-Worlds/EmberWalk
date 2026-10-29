import copy
import os
import unittest

import support
from ewscene import route


def hero():
    return copy.deepcopy(support.load_json(os.path.join(support.REPO_DIR, "fixtures", "synthetic", "hero-before", "spec.json")))


class TwoPartRoute(unittest.TestCase):
    def test_two_part_walk_inner_loop_then_corner_pans(self):
        """a two part walk is an inner loop, then corner pans"""
        _, parts_doc = route.build(hero())
        kinds = [part["kind"] for part in parts_doc["parts"]]
        first_pan = kinds.index("pan")
        self.assertNotIn("loop", kinds[first_pan:], "loops and pans alternate: %s" % "".join(k[0] for k in kinds))


if __name__ == "__main__":
    unittest.main()
