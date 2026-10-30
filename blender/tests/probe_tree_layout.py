import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bmesh

from ewscene import blendscene


class FixedDraw:
    def __init__(self, f):
        self.f = f

    def uniform(self, a, b):
        return a + self.f * (b - a)

    def choice(self, seq):
        return seq[0]

    def gauss(self, mu, sigma):
        return mu

    def random(self):
        return self.f


def recording(name, keep, first=1, count=3):
    real = getattr(blendscene, name)

    def record(*args, **kwargs):
        keep.append([list(a) if hasattr(a, "__len__") else a for a in args[first:first + count]])
        return real(*args, **kwargs)
    setattr(blendscene, name, record)
    return real


limbs, rods, blobs = [], [], []
conifer = {"height_in": 600, "canopy_in": 200, "trunk_in": 16}
real = recording("_conifer_limb", limbs, 2)
blendscene._conifer(bmesh.new(), bmesh.new(), conifer, FixedDraw(0.75))
blendscene._conifer_limb = real
oaks = []
for seed in ("oak-a", "oak-b", "oak-c"):
    rods.clear()
    blobs.clear()
    real_rod, real_blob = recording("_rod", rods, 1, 5), recording("_blob", blobs)
    oak = {"height_in": 360, "canopy_in": 300, "trunk_in": 20}
    blendscene._oak(bmesh.new(), bmesh.new(), oak, random.Random(seed))
    blendscene._rod, blendscene._blob = real_rod, real_blob
    oaks.append({"reach_in": oak["canopy_in"] / 2.0, "rods": rods[:2], "clumps": [b[1][0] for b in blobs]})
print("EW_LAYOUT " + json.dumps({"turn_draw": 0.75, "limbs": [[z, ang] for z, ang, _ in limbs], "oaks": oaks}))
