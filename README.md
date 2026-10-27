# EmberWalk

Wildfire defensible space checks from one phone video, using Meta SAM 3.1 and Muse on Cloudflare.

The goal: the homeowner films one walk around the house, and EmberWalk finds what could carry fire to the house and ranks what to fix first, with the California rule behind each item. That full walk is not built yet; the status below says what is.

**Status, Day 1 (Monday Oct. 26th, 2026):** the building blocks below are written and tested locally. The phone app and the walk pipeline are not built yet, no live Meta model call has run yet, and nothing is deployed.

## Architecture

```
phone app ──upload in parts──> R2
    │                          │
    └──> API Worker ──starts──> pipeline (Workflows)
                                   ├─> media Container (ffmpeg: clip, audio, stills)
                                   ├─> SAM 3.1 (find each object in the walk)
                                   ├─> Muse Spark (judge each finding against the rule)
                                   └─> D1 (walks, findings, report)
```

| Part | Folder | Today |
| --- | --- | --- |
| Phone app (React, offline capable) | `apps/web/` | Not built yet. |
| API Worker | `workers/api/` | Answers `GET /health` and the multipart upload API under `/api/uploads` (start, sign a part, complete, abort). Each part gets a SigV4 presigned PUT link straight to R2, with limits on part size and retries and a size cap set from the longest allowed walk (6 minutes). Only a walk in D1 that is waiting for its video can start an upload, with one open upload per walk, and completing it queues the walk. Nothing creates walks yet. |
| Walk pipeline (Workflows) | `workers/pipeline/` | Not built yet. |
| Media Container | `containers/media/` | A Node server around ffmpeg and ffprobe: `POST /probe`, `/clip`, `/audio` and `/stills`, with limits on input size, length, height and frame count. No Worker calls it yet. |
| Meta model client | `packages/meta/` | Calls SAM 3.1 on video and Muse Spark for text, JSON and tool calls. Prices every call, caches answers and refuses a call that would take the day's spend past a cap; the cache and the spend ledger are kept in memory so far. Tested offline only; no live call has run yet. |
| Contracts | `packages/shared/` | Zod schemas for API requests and errors, uploads, walks, findings and reports, limits and the cost ledger. The API Worker and the Meta model client use them today. |
| D1 | `migrations/` | Two tables so far: `signups`, for the landing page list, and `walks`, one row per filmed walk with its state. |
| R2 | `workers/api/wrangler.jsonc` | The media bucket, bound to the API Worker. |
| Site | `workers/static/` | The landing page and privacy page (browser tests check them at 390 and 1440 pixels wide), a signup endpoint checked with Turnstile and stored in D1, a welcome email through Resend, and a signed one click unsubscribe link. |
| Synthetic houses | `blender/` | Builds one side of a synthetic sample house in Blender from a JSON spec, writes its ground truth and renders a phone style walk, so findings can be scored against known answers. |

Muse Voice Transcribe (voice notes on a finding) and Muse Image (before and after pictures) are planned and not built yet.

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
