import copy
import json
import os
import sys

BLENDER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_DIR = os.path.dirname(BLENDER_DIR)
FIXTURE_DIR = os.path.join(REPO_DIR, "fixtures", "synthetic", "test-yard")

if BLENDER_DIR not in sys.path:
    sys.path.insert(0, BLENDER_DIR)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def sample_spec():
    return copy.deepcopy(load_json(os.path.join(FIXTURE_DIR, "spec.json")))


def fixture(name):
    return load_json(os.path.join(FIXTURE_DIR, name))


def blender_path():
    import shutil
    for candidate in (os.environ.get("EMBERWALK_BLENDER"), shutil.which("blender"), "/opt/homebrew/bin/blender",
                      "/Applications/Blender.app/Contents/MacOS/Blender"):
        if candidate and os.path.isfile(candidate):
            return candidate
    return None
