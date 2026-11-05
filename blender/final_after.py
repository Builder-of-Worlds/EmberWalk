# blender --background --factory-startup --python-exit-code 1 pile/hero-after.blend --python blender/final_after.py -- <code dir> --spec final/spec.json --out final/after.blend
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
CODE = argv[0]
sys.argv = sys.argv[:sys.argv.index("--") + 1] + argv[1:]
path = os.path.join(CODE, "blender", "final_look.py")
with open(path, encoding="utf-8") as f:
    text = f.read()
body, tail = text.rsplit("\nmain()", 1)
if tail.strip():
    raise SystemExit("EW_ERROR final_look.py no longer ends with a bare main() call")
ns = {"__name__": "final_look", "__file__": path}
exec(compile(body, path, "exec"), ns)
if os.environ.get("EW_SKIP_PILES") == "1":
    ns["build_piles"] = lambda: print("EW_PILE skipped", flush=True)
ns["main"]()
