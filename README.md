# EmberWalk

Wildfire defensible space checks from one phone video, using Meta SAM 3.1 and Muse on Cloudflare.

The goal: the homeowner films one walk around the house, and EmberWalk finds what could carry fire to the house and ranks what to fix first, with the California rule behind each item. That full walk is not built yet; the status below says what is.

**Status, Tuesday Oct. 27th, 2026:** the building blocks below are written and tested locally, including the phone app's screens and the walk pipeline from cut clips to ranked findings with blurred proof photos, and the API routes the phone reads a walk's results from. Nothing is deployed, so no walk has gone from a phone through the whole pipeline yet. The first live Meta model calls, SAM 3.1 and Muse Spark in a test run, were made late on Day 1 (commit 27d6fa1, $0.111).

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
| Phone app (React, offline capable) | `apps/web/` | Home, How it works, Fire rules (picked from the phone's location, `src/screens/Rules.tsx`), Record and Send screens behind hash routes (`src/router.ts`). It records the walk with the phone camera, keeps each take on the phone (`src/take-store.ts`), creates the walk through `POST /api/walks` and sends the video in parts to the upload API (`src/sender.ts`, `src/uploader.ts`). A service worker caches the app shell for offline use (`src/sw.ts`, `src/offline.ts`). A walk stopped by lost signal waits and sends itself when signal returns. Results and finding screens open the bundled synthetic sample house (`src/samples.ts`, every sample checked as synthetic at load); the three newest results opened are kept on the phone (`src/results-store.ts`), though the phone has no live results loader yet. `npm run build:judge -w apps/web` builds a static copy of the sample houses into `apps/web/dist/judge/` that runs from any folder with no network calls; it is built and tested here only. Not deployed; `npm run dev -w apps/web` proxies `/api` to a local API Worker. |
| API Worker | `workers/api/` | Answers `GET /health` and the multipart upload API under `/api/uploads` (start, sign a part, complete, abort). Each part gets a SigV4 presigned PUT link straight to R2, with limits on part size and retries and a size cap set from the longest allowed walk (6 minutes). Only a walk in D1 that is waiting for its video can start an upload, with one open upload per walk, and completing it queues the walk and asks the pipeline to start it. `POST /api/walks` creates a walk that waits for its video (`workers/api/src/walk-create.ts`). `POST /api/walks/{walkId}/tags` stores up to 20 tags for a walk that is still waiting for its video, all or none (`workers/api/src/walk-tags.ts`). Three GET routes read a walk back for the visitor who made it, named by the `x-emberwalk-visitor` header (`workers/api/src/walk-read.ts`): `GET /api/walks/{walkId}` gives its state and any failure. Once the walk is done, `GET /api/walks/{walkId}/results` gives its open findings in rank order, each with its rule sources, proof frame, box and seconds into the walk, plus the concepts that were not checked. `GET /api/walks/{walkId}/stills/{findingId}` streams that finding's own blurred still from R2 and nothing else. |
| Walk pipeline (Workflows) | `workers/pipeline/` | A Workflow (`src/workflow.ts`) that claims a queued walk, probes the video and cuts a clip for the loop and the pan of the walk through the media Container (`src/prepare.ts`), uploads each clip to Meta and asks SAM 3.1 for each concept with retries (`src/segment.ts`), then stores the tracks and marks the walk done (`src/store.ts`). A refusal or a failure marks the walk failed with a plain reason. It also answers the API Worker's request to start a walk (`src/start.ts`). It does not yet call Muse Spark, the rules engine, voice or images. Tested in the Workers test pool; not deployed, and `wrangler.jsonc` has no `MEDIA_CONTAINER` binding yet. |
| Media Container | `containers/media/` | A Node server around ffmpeg and ffprobe: `POST /probe`, `/clip`, `/audio` and `/stills`, with limits on input size, length, height and frame count. The pipeline calls `/probe` and `/clip` (`workers/pipeline/src/media.ts`); nothing calls `/audio` or `/stills` yet. |
| Meta model client | `packages/meta/` | Calls SAM 3.1 on video and Muse Spark for text, JSON and tool calls. Prices every call, caches answers and refuses a call that would take the day's spend past a cap. The package keeps the cache and the spend ledger in memory; the pipeline plugs in a cache stored in R2 and D1 and the D1 ledger (`workers/pipeline/src/deps.ts`). Only SAM 3.1 is called from a Worker today. Tested offline, and in opt in live test runs against SAM 3.1 and Muse Spark (the first in commit 27d6fa1, $0.111). |
| Rules engine | `packages/rules/` | The California rule table (PRC 4291, Gov. Code 51182, 14 CCR 1299.03 and the CAL FIRE Zone 0 guidance) as data, each rule with its citation and zone distances. Looks rules up by what was seen, turns observations into findings ranked fix first, and checks recorded SAM answers and findings against a synthetic house's known answers. Pure functions, tested offline; nothing calls it yet. |
| Explainer | `packages/explain/` | Pipeline step 5 as a module. Builds the one Muse Spark request per walk: the jurisdiction's rule table first, the same bytes for every walk so it can be billed at the cached rate, then the ranked findings, what the homeowner said and up to 10 proof frame links, asking for low reasoning effort and JSON by a schema; an answer that fails the schema is refused. Tested offline only; nothing calls it yet. |
| Get It Fixed agent | `packages/agent/` | The Muse Spark tool loop for one job (`src/loop.ts`): it offers two tools, `find_crews` and `draft_request` (`src/tools.ts`), checks every use against the job before it runs (the job's trade and ZIP, crews the job found, the job's own findings, one draft per crew, sample crews only on a synthetic walk), answers a failed check with an error the model can correct, asks again after a malformed turn at most twice, and stops at six requests. Drafts are stored for the homeowner to approve; no tool can send, approve or edit a message. Flagged off: it refuses unless told it is on, and nothing calls it yet. Tested offline on a local D1 with shaped answers only. |
| Contracts | `packages/shared/` | Zod schemas for API requests and errors, uploads, walks, findings and reports, limits and the cost ledger. The API Worker, the phone app, the database layer, the pipeline and the Meta model client use them today. |
| D1 | `migrations/` | `signups` for the landing page list, `walks` (one row per filmed walk, with its state and, when it failed, why), `tags` and `clips` of a walk, SAM `concept_runs` and `tracks`, `findings`, the `cost_records` ledger and the `cache_entries` index. |
| Database layer | `packages/db/` | Typed queries over D1 for walks (claim, step, complete, fail), tags, clips, detections, findings, the spend ledger and the cache index. Every write is checked against the shared contracts first. The API Worker and the pipeline use it. Tested on a local D1 only. |
| R2 | `workers/api/wrangler.jsonc` | The media bucket, bound to the API Worker. |
| Site | `workers/static/` | The landing page and privacy page (browser tests check them at 390 and 1440 pixels wide), a signup endpoint checked with Turnstile and stored in D1, a welcome email through Resend, and a signed one click unsubscribe link. |
| Sample walk import | `packages/sample-import/` | Sends a rendered synthetic walk through the real API as a phone would: it checks that `render.json` and `motion.json` are marked synthetic and labelled "Synthetic sample house", that both describe the same scene and length, and that the video matches the size and sha256 in `render.json`, then creates the walk (`synthetic: true`), stores its motion as one loop tag, uploads the video in parts and completes it. The command is `npm run import -w packages/sample-import -- --origin <url> --render <folder>`; it refuses to write to a real R2 bucket unless given `--allow-real-r2`. Tested against the API Worker in the Workers test pool, and in an L2 test (`packages/sample-import/test/l2/`) that imports a 20 second, 2.4 MB copy of the render (`fixtures/synthetic/test-yard-2/import/`) and runs pipeline steps 1 to 3 on it with stand-in SAM answers built from `truth.json`; `npm run test:full-render -w packages/sample-import` runs the same test on the full 25.8 MB render kept outside the repository in `~/emberwalk-renders/test-yard-2/`. |
| Synthetic houses | `blender/` | Builds one side of a synthetic sample house in Blender from a JSON spec, writes its ground truth and renders a phone style walk, so findings can be scored against known answers. |

Muse Voice Transcribe (voice notes on a finding) and Muse Image (before and after pictures) are planned and not built yet.

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
