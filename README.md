# EmberWalk

Wildfire defensible space checks from one phone video, using Meta SAM 3.1 and Muse on Cloudflare.

**Status, Friday Oct. 30th, 2026:** Get It Fixed is built, and the first deploy is ready.

## What it does

The homeowner films one walk around the house, and EmberWalk finds what could carry fire to the house and ranks what to fix first, with the California rule behind each item.

As of the end of Day 5:

- **Film one walk.** The loop around the house is followed by a pan of the yard from each side, tagged by corner, and one side or corner can be filmed again on its own. Walks upload while they are recorded and pick up again when signal returns, and the phone keeps each walk's video, so a house is never walked twice.
- **What the app finds.** All 25 objects on the list, from dry brush and fences to gas cans, grills and wooden decks, each at a published source's distance. A second model reviews each finding and shows its reason when it sees it differently.
- **How results look.** Required Now first, with a fix first list. The house is drawn from above with rings at 5, 30 and 100 feet and a numbered pin for each finding. See It Fixed previews the top three findings fixed, labelled as an AI preview.
- **Get It Fixed.** The homeowner enters a ZIP code and sees licensed crews for each kind of work, closest first. Nothing is sent until the homeowner approves it.
- **Defensible space record.** Each finding is marked Needs Fixing, Fix Planned or Done, with its date.

## How it works

```
phone app ──upload in parts──> R2
    │                          │
    └──> API Worker ──starts──> pipeline (Workflows)
                                   ├─> media Container (ffmpeg: clip, audio, stills)
                                   ├─> SAM 3.1 (find each object in the walk)
                                   ├─> Muse Spark (judge each finding against the rule)
                                   └─> D1 (walks, findings, report)
```

Every house shown in this project is synthetic and labelled "Synthetic sample house".

## Stack

TypeScript, Cloudflare Workers, R2, D1 and Containers, React and Vite for the phone app (`apps/web/`), Cloudflare Workflows for the walk pipeline (`workers/pipeline/`), Zod, Vitest with the Workers test pool, ffmpeg, Blender with Python 3, Playwright.

## Setup

Needs Node 24, npm 11, Python 3 and ffmpeg (with ffprobe) on the path. Blender is optional.

```sh
npm install
```

## Tests

```sh
npm test
```

This runs every package's Vitest suite (Workers run in the local Workers runtime, D1 and R2 are local) and the Blender scene tests. The 11 scene re-measure tests and the 8 mask render tests need Blender, and one probe test needs ffmpeg; each is skipped when its program is missing. No test calls a paid model.

Also: `npm run typecheck`, `npm run lint`, `sh tools/license-check.sh` (every installed package must carry a permissive license), and the browser tests of the site and the phone app with `npm run test:e2e -w workers/static` and `npm run test:e2e -w apps/web` (they need a Chromium for Playwright).

## The story

Defensible space is the buffer a homeowner keeps between a house and the plants, wood and clutter that could carry fire to it. Checking it by hand means walking every side of the house with a checklist. EmberWalk aims to turn that walk into one phone video: film once, get a ranked list of what to fix, each item with the rule behind it and the picture that shows it.

EmberWalk is built during the Meta Global AI Developer Hackathon, Monday Oct. 26th to Wednesday Nov. 4th, 2026. This repository gets one commit a day, and each day has a short write-up in `docs/devlog/`.

| Day | Date | Built |
| --- | --- | --- |
| 1 | Monday Oct. 26th | Landing page with signup, the video upload API, the ffmpeg media Container, the Meta model client for SAM 3.1 and Muse Spark, the shared contracts and the synthetic house builder. [Write-up](docs/devlog/day-01.md) |
| 2 | Tuesday Oct. 27th | Phone screens, results screens, the walk pipeline steps, the rules engine and the privacy blur. [Write-up](docs/devlog/day-02.md) |
| 3 | Wednesday Oct. 28th | Results back on the phone, one side redone, the coverage check, the location step and plainer wording. [Write-up](docs/devlog/day-03.md) |
| 4 | Thursday Oct. 29th | The two part walk, light on each side, the checking screen's step counts, the full object list in the pipeline and rules by state. [Write-up](docs/devlog/day-04.md) |
| 5 | Friday Oct. 30th | Get It Fixed, See It Fixed and the second check, the house drawn with its findings, rules for the newer objects, the walk sent while recorded and a first deploy made ready. [Write-up](docs/devlog/day-05.md) |

## License

Apache License 2.0 (`LICENSE`), except `blender/`, which is GPL 3.0 or later (`blender/LICENSE`), because Blender requires scripts that use its Python API to be GPL.

The landing page ships GSAP 3.15.0 (`workers/static/public/vendor/`), which is not under Apache 2.0. It is under the Standard "No Charge" GSAP License (https://gsap.com/standard-license, read Thursday Oct. 29th, 2026), which allows free use, commercial use included, and prohibits its use in tools that let users build visual animations without code. Its notice is in `NOTICE`.

Synthetic scene assets: Powered by Poly Haven (https://polyhaven.com), CC0.

The landing page photos and the synthetic house stills in `fixtures/synthetic/hero-look/` are AI generated with Google's Nano Banana Pro image model (nano-banana-pro), and the landing page's opening film frames with Kling (kling-v3). The phone screens on the landing page are screen captures of the app showing a synthetic sample walk. No real house or person is shown.
