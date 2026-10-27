# Day 1: Monday Oct. 26th, 2026

The first day laid the building blocks under the walk: the contracts, the upload path, the media tools, the model client and a way to make test houses with known answers. Everything below runs and is tested on a laptop; nothing is deployed yet.

## Built

- **Landing page** (`workers/static/`): the page and privacy page, checked by browser tests at 390 and 1440 pixels wide, a signup form checked with Cloudflare Turnstile and stored in D1, a welcome email through Resend with the postal address and a signed one click unsubscribe link.
- **Video upload API** (`workers/api/`): a long walk video goes straight from the phone to R2 in parts. The Worker starts the upload, signs each part with a short lived SigV4 link, completes or aborts it, and only lets a walk that is waiting for its video have one open upload.
- **Media Container** (`containers/media/`): a small server around ffmpeg and ffprobe that probes a video, cuts a clip, pulls the audio and pulls still frames, with limits on size, length, height and frame count.
- **Meta model client** (`packages/meta/`): calls for SAM 3.1 on video and for Muse Spark text, JSON and tool calls, with a price for every call, an answer cache and a daily spend cap that refuses a call that would go past it. The cache and the spend ledger are kept in memory so far.
- **Contracts** (`packages/shared/`): Zod schemas for the API, uploads, walks, findings and reports, limits and the cost ledger, used today by the upload API and the model client.
- **Synthetic sample houses** (`blender/`): builds one side of a synthetic house in Blender from a JSON spec, writes the ground truth of every hazard and renders a phone style walk, so the checks can be scored against known answers.
- **D1 tables**: `signups` and `walks`.

## Numbers

`npm test` on a fresh install of this repository, run Monday Oct. 26th, 2026: 498 tests, all passing.

| Area | Tests |
| --- | --- |
| Site (`workers/static`) | 131 |
| Video upload API (`workers/api`) | 96 |
| Meta model client (`packages/meta`) | 60 |
| Contracts (`packages/shared`) | 46 |
| Media Container (`containers/media`) | 45 |
| Synthetic sample houses (`blender`) | 120 |

## Not built yet

The phone app, the walk pipeline that ties these parts together, Muse Voice Transcribe and Muse Image. No live call to a Meta model has run yet.
