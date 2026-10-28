# fixtures/catalog

Stand-in data for the object catalog (`packages/catalog`) and its pipeline step (`workers/pipeline/src/catalog-step.ts`). Nothing here is a real photo, video or answer from a model.

- `yard-objects/truth.json`: a made-up back yard, labelled "Synthetic sample house" and marked `"synthetic": true`, in the shape of `fixtures/synthetic/test-yard-2/truth.json`. It places one existing concept (a wood pile) and four catalog objects the rules engine cannot yet explain (a gas can, a lawn mower, a grill, a tarp), each with the frames it shows on and a box in pixels of a 320 by 334 frame.
- `yard-objects/answers.json`: the SAM answers a model would give for that yard, built from `truth.json` box for box, keyed by the SAM phrase asked. The pipeline tests turn them into SAM answer text with `workers/pipeline/test/harness.ts`. Confidence scores are invented.
