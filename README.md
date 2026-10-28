# EmberWalk

Wildfire defensible space checks from one phone video, using Meta SAM 3.1 and Muse on Cloudflare.

**Status, Wednesday Oct. 28th, 2026:** a walk sent from the phone comes back as ranked results in a test run.

## What it does

The homeowner films one walk around the house, and EmberWalk finds what could carry fire to the house and ranks what to fix first, with the California rule behind each item.

As of the end of Day 3:

- **Film one walk.** The phone records from the rear camera, sends the walk in parts, says the walk is being checked and opens the results when the check is done.
- **Did the walk cover the house?** The check confirms the walk went all the way around, ended where it started and showed the base of the wall on every side. If a side was missed, the phone asks for that side alone, with a tip on how to film it.
- **What the app finds.** Dry brush, fences and other hazards near the house, each with its rule and a blurred proof photo. A catalog of 25 things to look for gives a plain reason each matters in a fire.
- **How results look.** Required Now first, and a fix first list of the three nearest open findings within 30 feet of the house. Every rule is in English and Spanish and says what to do and how.
- **Voice notes.** Spoken notes are written out and attached to the finding they describe.
- **Get It Fixed.** Quote requests list the exact work with a blurred photo per item, follow ups are drafted after 3 days, and nothing is sent without the homeowner's approval.

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

## License

Apache License 2.0 (`LICENSE`), except `blender/`, which is GPL 3.0 or later (`blender/LICENSE`), because Blender requires scripts that use its Python API to be GPL.

Synthetic scene assets: Powered by Poly Haven (https://polyhaven.com), CC0.
