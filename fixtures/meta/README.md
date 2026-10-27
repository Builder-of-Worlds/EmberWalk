# fixtures/meta

Answers from the Meta Model API used by the offline tests in `packages/meta/`. Synthetic content only.

- `tool-call.json`: a Muse Spark Responses answer with one `judge_detection` function call whose arguments pass the schema, after a `reasoning` item.
- `tool-call-malformed.json`: a call with arguments that fail the schema (negative frame, a string for `keep`, a plant state on a wood pile, an empty reason).
- `tool-final.json`: the answer after the tool result is sent back.
- `box-probe-test-yard-2-answers.json`: every raw answer of the two live box probe passes on the second test yard (Muse Spark gives a box, SAM 3.1 tracks it), keyed `pass1-` or `pass2-` plus the request fingerprint. 12 Muse Spark answers and 12 SAM answers; every one found its hazard.
- `box-probe-test-yard-2-rows.json`: the 6 scored rows of each pass (hazard, prompt frame, the Muse Spark box in grid units and pixels, hits, cost) with the fingerprints (`sparkFingerprint`, `samFingerprint`) that name the answers above.

Source: `tool-call.json` and `tool-final.json` are recorded unchanged from a live `muse-spark-1.3` round trip run on Monday Oct. 26th, 2026 (`packages/meta/test/meta.live.test.ts`). The two `box-probe-` files are recorded unchanged from the live run of `packages/meta/test/box-probe.live.test.ts` on Tuesday Oct. 27th, 2026 (second pass of the day; the first run's answers did not complete and are not kept). `tool-call-malformed.json` is shaped from https://dev.meta.ai/docs/tool-calling and https://dev.meta.ai/docs/api-reference/responses/schemas, read Monday Oct. 26th, 2026.
