# EmberWalk

Wildfire defensible space checks from one phone video, using Meta SAM 3.1 and Muse on Cloudflare.

**Status, Monday Oct. 26th, 2026:** the first building blocks are built and tested. The phone app and the walk pipeline come next.

## What it does

EmberWalk is a wildfire defensible space check built around one video: the homeowner films a single walk around the house, and EmberWalk finds what could carry fire to the house and ranks what to fix first, with the California rule behind each item.

At the end of Day 1 the foundation under that walk is in place.

- **A place to sign up.** The home page and the privacy page are in place, with a signup form protected by Cloudflare Turnstile and a welcome email that has a one click unsubscribe link.
- **A way to send a long walk.** A walk video of up to 6 minutes goes from the phone to storage in parts, so a big file arrives in pieces, with one open upload per walk.
- **Tools to read the video.** The media tools learn what a video holds, cut clips, and pull the audio and still frames.
- **Two Meta models to look through it.** SAM 3.1 finds objects in video and Muse Spark handles text and tool calls, with every call priced, answers cached and a daily spending cap.
- **Sample houses with known answers.** Synthetic houses record the true position of every hazard and render a phone style walk, so each later check can be scored as right or wrong.

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

TypeScript, Cloudflare Workers, R2, D1 and Containers, Zod, Vitest with the Workers test pool, ffmpeg, Blender with Python 3, Playwright. The phone app will be React and the walk pipeline Cloudflare Workflows.

## Setup

Needs Node 24, npm 11, Python 3 and ffmpeg (with ffprobe) on the path. Blender is optional.

```sh
npm install
```

## Tests

```sh
npm test
```

This runs every package's Vitest suite (Workers run in the local Workers runtime, D1 and R2 are local) and the Blender scene tests. The 11 scene re-measure tests need Blender and one probe test needs ffmpeg; each is skipped when its program is missing. No test calls a paid model.

Also: `npm run typecheck`, `npm run lint`, `sh tools/license-check.sh` (every installed package must carry a permissive license), and the site's browser tests with `npm run test:e2e -w workers/static` (needs a Chromium for Playwright).

## The story

Defensible space is the buffer a homeowner keeps between a house and the plants, wood and clutter that could carry fire to it. Checking it by hand means walking every side of the house with a checklist. EmberWalk aims to turn that walk into one phone video: film once, get a ranked list of what to fix, each item with the rule behind it and the picture that shows it.

EmberWalk is built during the Meta Global AI Developer Hackathon, Monday Oct. 26th to Wednesday Nov. 4th, 2026. This repository gets one commit a day, and each day has a short write-up in `docs/devlog/`.

| Day | Date | Built |
| --- | --- | --- |
| 1 | Monday Oct. 26th | Landing page with signup, the video upload API, the ffmpeg media Container, the Meta model client for SAM 3.1 and Muse Spark, the shared contracts and the synthetic house builder. [Write-up](docs/devlog/day-01.md) |

## License

Apache License 2.0 (`LICENSE`), except `blender/`, which is GPL 3.0 or later (`blender/LICENSE`), because Blender requires scripts that use its Python API to be GPL.

Synthetic scene assets: Powered by Poly Haven (https://polyhaven.com), CC0.
