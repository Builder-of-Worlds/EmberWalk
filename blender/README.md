# Scene builder

Builds one side of a synthetic sample house in Blender from a scene spec, writes its ground truth and phone style motion file, and renders the walk. Everything in this folder is GPL 3.0 or later (`LICENSE`).

Every house built here is a "Synthetic sample house".

## Commands

- Unit tests (no Blender needed except the re-measure test): `python3 -m unittest discover blender/tests`
- Build a scene: `blender --background --factory-startup --python-exit-code 1 --python blender/build_scene.py -- <spec.json> [--out DIR]`

- Render the walk: `blender --background --factory-startup --python-exit-code 1 <scene.blend> --python blender/render_walk.py -- --out <walk.mp4>`
- Tight truth boxes: `blender --background --factory-startup --python-exit-code 1 <scene.blend> --python blender/render_masks.py -- --out <boxes.json>` renders a flat colour pass of every frame and writes the tightest box round each hazard's pixels. `python3 blender/write_files.py <spec.json> --out DIR --mask-pass <boxes.json>` then writes them into `truth.json` as `frame_boxes`, and sets each hazard's visible windows from the pass. A pass with a missing frame, a wrong hazard list or a box outside the image is refused (exit 3).

Output goes to `$EMBERWALK_RENDERS/<scene id>/` (default `~/emberwalk-renders/`), never into git.

## Specs and files

- Scene spec: `schemas/scene-spec.schema.json`. Every length is in whole inches. Axes: x along the wall from its right end as seen from the yard, y out from the wall face, z up from the ground.
- A hazard past 100 feet, a negative distance or an asset not in `assets.json` is refused.

## Assets

Only the assets named in `assets.json` are used. Poly Haven assets are CC0 and are fetched by id through the Poly Haven API at build time into `$EMBERWALK_ASSETS/polyhaven/` (default `~/emberwalk-assets/`), outside git, with each file's checksum checked. Nothing fetched reaches the app. Scripted shapes (the wood pile and the fence) are made by `ewscene/blendscene.py` and carry Poly Haven textures.

## Hero house

The hero house is a whole house with four sides, not one side, so it has its own spec and truth beside the one side files, which are unchanged.

- `schemas/house-spec.schema.json` (`emberwalk.house-spec/1`) and `schemas/house-truth.schema.json` (`emberwalk.house-truth/1`). House axes: x east, y north, z up, origin at the south west corner, whole inches. Front faces south. The route block in the spec is a placeholder until the route task fills it.
- `ewscene/house.py`: loading and checks as pure functions (no Blender), the truth made from a spec, and the after spec made from a before spec and `changes.json` (only hazards change; a fixed hazard is moved or resized and listed under `fixed`, no longer a hazard).
- `check_house.py <spec.json or truth.json> [--changes changes.json]`: exit 0 with one summary line, exit 3 with the reason and nothing written. Rule ids, concepts, zones and statutes are read from the rules package at run time with node; if node does not run the check exits 3.
- `fixtures/synthetic/hero-before/spec.json` and `fixtures/synthetic/hero-after/changes.json`: the before house and what the after scene does to each hazard.
- `ewscene/route.py` `build(spec)`: the walk's `motion.json` (one pose a frame in house axes) and `parts.json` (`emberwalk.route-parts/1`, each loop stretch and pan with its seconds and frames) from the spec's `route` settings. One clockwise lap from the front door at the standoff, facing the wall, stopping at each corner and each side's middle for a pan out to the yard; on a porch, deck or landing the camera rises by its height, eased over one stride. Refused: a standoff outside 120 to 144 in, a pan outside 10 to 20 s, a walk over 330 s, a loop that leaves the lot, a camera inside the house or a hazard box, a heading turn over 15 degrees between frames.
- `check_openart.py --look look.json` (`emberwalk.openart-look/1`): every OpenArt still of the house's look with its model, prompt, reference (`board`, `blender_frame` with its frame, or `none`), credits and original file by name, size and sha256, and the owner's pick of one still per view (`front`, `east`, `west`, `north`, `after_front`) with its committed JPEG copy of 500,000 bytes or less. Exit 0 prints the credit total; exit 3 with the reason. Spend has no cap; the check only makes the total add up.
- `assets.json` carries scripted entries for the hero hazards that have no shape yet (gutter leaves, vent mulch, overhanging branch, shrub, propane tank, shed, trash cans, patio set, tall grass). The shapes themselves are built by the scene builder task.
- Tests: `python3 -m unittest blender.tests.test_house`.

Powered by Poly Haven (https://polyhaven.com).
