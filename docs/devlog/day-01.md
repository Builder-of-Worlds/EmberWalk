# Day 1: Monday Oct. 26th, 2026

The first day laid the foundation under the walk: the shared contracts, the upload path, the media tools, the model client and synthetic sample houses with known answers, so that every later check can be scored.

## Built

- **Landing page**: the home page and the privacy page, checked at phone and desktop widths so both read cleanly on a small screen and a large one. A visitor can join the list through a signup form protected by Cloudflare Turnstile, which keeps automated signups out, and each signup is stored. Every new signup gets a branded welcome email with the postal address and a signed, one click unsubscribe link, so leaving the list takes a single tap.
- **Video upload**: a long walk video, up to 6 minutes, goes straight from the phone to storage in parts, each part signed with a short lived link, with limits on part size and on retries. A homeowner's big file does not have to squeeze through one request. Only a walk that is waiting for its video can start an upload, there is one open upload per walk, and an upload can be finished or cancelled. Finishing an upload queues the walk for checking. The size of an upload is capped from the longest walk allowed, so an oversized file is turned away at the start.
- **Media Container**: probes a video to learn what it holds, cuts clips, and pulls the audio and still frames. It works within set limits on file size, length, height and frame count, so every later step receives pieces of a size it can handle.
- **Meta model client**: calls SAM 3.1 on video to find objects and Muse Spark for text, structured answers and tool calls, so the rest of the system can read what comes back. Every call is priced, answers are cached so the same question is not asked twice, and a daily spending cap turns away any call that would go past it, so the spend for a day is always bounded.
- **Contracts**: one set of schemas for the API, walks, uploads, findings, reports, limits and costs, shared by every part of the system, so the phone, the server and the checks all describe a walk in the same way. The upload path and the model client already use them.
- **Synthetic sample houses**: a house side generated from a written spec, with every hazard's true position recorded and a phone style walk rendered. Because the right answer is known for each hazard, every check can be marked right or wrong instead of judged by eye.
- **Database**: tables for signups and walks, so each signup and each walk has a record from the start, and an upload can be matched to the walk that is waiting for it.

## Numbers

The full test run, Monday Oct. 26th, 2026: 498 tests, all passing.
