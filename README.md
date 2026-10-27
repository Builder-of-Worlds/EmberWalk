# EmberWalk

Wildfire defensible space checks from one phone video, using Meta SAM 3.1 and Muse on Cloudflare.

**Status, Tuesday Oct. 27th, 2026:** the phone screens and the walk pipeline are built and tested, and the first SAM 3.1 and Muse Spark calls have run.

## What it does

The homeowner films one walk around the house, and EmberWalk finds what could carry fire to the house and ranks what to fix first, with the California rule behind each item.

As of the end of Day 2:

- **Film one walk.** The phone app records from the rear camera and sends the walk in parts. If the connection drops, the upload carries on, and a walk stopped by lost signal sends itself when signal returns. The app opens offline after the first visit.
- **What the app finds.** SAM 3.1 finds objects in the video, Muse Spark points out dry brush and fences, and each one is tracked through the walk. The walk video is deleted when the check ends.
- **How the results look.** Findings come in Simple and Detailed views with Required Now first. Each finding shows its rule from 38 California rules, is worded in plain language and comes with a proof photo that is blurred before it is kept. A walk that was not fully covered is never shown as green. This Isn't Right sets a finding aside until Undo.
- **Get It Fixed.** An agent finds crews and drafts requests for the homeowner to read, and nothing is sent without the homeowner's approval.
- **Try it on sample houses.** Synthetic sample houses, always labelled as such, show the whole flow without anyone's real home.

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

## License

Apache License 2.0 (`LICENSE`), except `blender/`, which is GPL 3.0 or later (`blender/LICENSE`), because Blender requires scripts that use its Python API to be GPL.

Synthetic scene assets: Powered by Poly Haven (https://polyhaven.com), CC0.
