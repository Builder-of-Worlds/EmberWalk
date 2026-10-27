# Scene builder

Builds one side of a synthetic sample house in Blender from a scene spec, writes its ground truth and phone style motion file, and renders the walk. Everything in this folder is GPL 3.0 or later (`LICENSE`).

Every house built here is a "Synthetic sample house".

## Commands

- Unit tests (no Blender needed except the re-measure test): `python3 -m unittest discover blender/tests`
- Build a scene: `blender --background --factory-startup --python-exit-code 1 --python blender/build_scene.py -- <spec.json> [--out DIR]`

Output goes to `$EMBERWALK_RENDERS/<scene id>/` (default `~/emberwalk-renders/`), never into git.

## Specs and files

- Scene spec: `schemas/scene-spec.schema.json`. Every length is in whole inches. Axes: x along the wall from its right end as seen from the yard, y out from the wall face, z up from the ground.
- A hazard past 100 feet, a negative distance or an asset not in `assets.json` is refused.

## Assets

Only the assets named in `assets.json` are used. Poly Haven assets are CC0 and are fetched by id through the Poly Haven API at build time into `$EMBERWALK_ASSETS/polyhaven/` (default `~/emberwalk-assets/`), outside git, with each file's checksum checked (D-75). Nothing fetched reaches the app. Scripted shapes (the wood pile and the fence) are made by `ewscene/blendscene.py` and carry Poly Haven textures.

Powered by Poly Haven (https://polyhaven.com).
