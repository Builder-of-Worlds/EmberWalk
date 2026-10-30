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
- Mask pass for the house: `build_house.py` tags each wood deck or porch finding (a wood structure inside its rule's reach) with its id like a hazard, so `render_masks.py` gives it a level and `truth.attach_boxes` writes its `frame_boxes`, `visible_frames` and `visible_s` into `structure_hazards`. The pass must name every hazard id and every wood finding id on every frame, and holds at most `maskbox.CAPACITY` (51) of them. An id may be used once across hazards and structures.
- `write_files.py --house <spec.json> --out DIR [--changes changes.json] [--mask-pass boxes.json]`: writes `motion.json`, `parts.json` and the house `truth.json` (with the pass's boxes when given). Exit 2 for a spec the house check refuses, 3 for a pass that does not fit; nothing is written then.
- The hero walk's frames and video: `render_frames.py -- --spec SPEC [--changes changes.json] --motion motion.json --frames DIR --cycles64` (run it with `blender --background --factory-startup --python-exit-code 1 scene.blend --python`) renders the PNG frames in resumable chunks and prints one `EW_FRAME <n> <seconds> s` line each; keep its output in a log. `assemble_walk.py --frames DIR --motion motion.json --log render.log --out <scene id>/walk.mp4` joins them at the walk's fps and writes `walk.mp4.settings.json` (engine, samples, render seconds, Blender version, machine); exit 3 names missing frames. `probe_render.py <scene id> --motion motion.json --out render.json` then checks the video against the motion file and writes `render.json`. The video is always `<scene id>/walk.mp4` in the renders folder.
- Recheck stills: `blender --background --factory-startup --python-exit-code 1 AFTER/scene.blend --python render_recheck.py -- --spec before-spec.json --changes changes.json --truth before-truth.json --motion before-motion.json --out STILLS_DIR --recheck recheck.json` renders the after scene from the before walk's camera pose at each Required Now hazard's proof frame (the frame where its mask area in the before truth is largest), plus that pose's mask pass, and writes `recheck.json` (`schemas/recheck.schema.json`) after `ewscene/recheck.py` checks it. Exit 3 when the check refuses it. A fixed hazard that is out of view from the old pose has area 0 and no box.
- Hero files check: `python3 blender/check_hero.py [--fixtures DIR]` judges the `hero-before` and `hero-after` truth, motion, parts and render files (and `spec.json`, `changes.json`) with the checks in `ewscene/herocheck.py`. Exit 0 only when every file is there and clean, 1 on any problem, 2 on any missing file; it runs in the kiln sequence, never in the test suite, because only the kiln makes those files.
- Renders between machines: renders never enter git, and a render set moves one way, from the rendering machine to The Forge, on the Lead's say. For the kiln: `rsync -a kiln-ts:emberwalk-renders/hero-before/ ~/emberwalk-renders/hero-before/`, then `python3 blender/check_arrival.py fixtures/synthetic/hero-before/render.json`; the same for `hero-after` with its `render.json` and `recheck.json`, and `hero-look` with `look.json`. `check_arrival.py <render.json, look.json or recheck.json> [--renders DIR]` exits 0 with one line when every listed file is there with the size and sha256 the record gives, and exits 3 naming each file that is missing, a different size or a different hash; nothing reads a moved file before it passes.
- Tests: `python3 -m unittest blender.tests.test_house`.

Powered by Poly Haven (https://polyhaven.com).
