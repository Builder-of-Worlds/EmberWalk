# fixtures/meta

Answers from the Meta Model API used by the offline tests in `packages/meta/`. Synthetic content only.

- `tool-call.json`: a Muse Spark Responses answer with one `judge_detection` function call whose arguments pass the schema.
- `tool-call-malformed.json`: the same call with arguments that fail the schema (negative frame, a string for `keep`, a plant state on a wood pile, an empty reason).
- `tool-final.json`: the answer after the tool result is sent back.

Source: shaped from https://dev.meta.ai/docs/tool-calling and https://dev.meta.ai/docs/api-reference/responses/schemas, read Monday Oct. 26th, 2026. They are replaced by answers recorded from the live run when that run passes.
