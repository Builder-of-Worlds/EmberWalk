import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bmesh
import bpy

from ewscene import blendscene
from ewscene.units import in_to_m

bm = bmesh.new()
for x in range(996, 1069, 6):
    for y in (100, 140):
        for z in (230, 260):
            bm.verts.new((in_to_m(x), in_to_m(y), in_to_m(z)))
mesh = bpy.data.meshes.new("probe-branch")
bm.to_mesh(mesh)
bpy.data.objects.new("probe-branch", mesh)
h = {"id": "probe-branch", "distance_in": 36, "size_in": [96, 72, 40]}
print("EW_ROOT " + json.dumps(blendscene.branch_root(h, {"start": (960, 408), "n": (1, 0)})))
