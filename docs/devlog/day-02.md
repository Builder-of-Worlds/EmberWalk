# Day 2: Tuesday Oct. 27th, 2026

The second day put screens on the phone and stages in the pipeline: the app now records, sends and shows results for a sample house, and the pipeline can find objects, place them near the house and rank what to fix. Everything below runs and is tested on a laptop; nothing is deployed yet.

## Built

- **Phone app** (`apps/web/`): Home, How Your Walk Works, the fire rules step, Record and Send. It records from the rear camera, keeps the take on the phone and sends it in parts, carrying on after a dropped connection; a walk stopped by lost signal sends itself when signal returns. It loads offline after the first visit, and no screen scrolls sideways at 390 pixels.
- **Results screens** (`apps/web/`): Simple and Detailed lists, Required Now first, never green while the walk is incomplete. A finding shows its rule, and This Isn't Right removes it until Undo. The three newest results stay on the phone. A static copy of the sample houses runs from any folder with no network calls, and every sample is checked as synthetic when it loads.
- **Walk start API** (`workers/api/`): `POST /api/walks` creates a walk, a tags route stores what the phone noted, and completing an upload asks the pipeline to start once. Status, results and proof photo routes answer only the phone that made the walk, and the phone loads a walk's results from them. The real call to the pipeline is not shown yet; it needs a deploy.
- **Walk pipeline** (`workers/pipeline/`): cuts clips, finds objects with SAM 3.1, has Muse Spark point at the dry brush and the fence and tracks them, stores the tracks in D1 and saves ranked findings, safely run twice. The walk video is deleted when the check ends. Tested with recorded answers only.
- **Rules engine** (`packages/rules/`): 38 California rules as 74 rows by zone and citation, turned into findings ranked fix first. A plant judged alive gets no dead fuel finding. A scorer checks findings against a synthetic house's known answers.
- **Privacy blur** (`containers/media/`): the Container blurs up to 32 named regions in a still, and the walk pipeline now blurs every proof photo before it is kept and has Muse Spark word each finding. Tested with recorded answers only.
- **Get It Fixed agent** (`packages/agent/`): a Muse Spark tool loop that finds crews and drafts requests for the homeowner to approve. Flagged off and called by nothing; no path sends a message without approval, and the database refuses it too.
- **Sample walk import** (`packages/sample-import/`): sends a rendered synthetic walk through the real API as a phone would, then runs the first three pipeline steps on it, labelled "Synthetic sample house" throughout.
- **Synthetic sample houses** (`blender/`): a second test yard where the fence stays 400 pixels wide or more for ten frames in a row, with a box for every hazard on every frame.
- **D1 tables**: clips, tags, detections, findings, the cost ledger, jobs and an approval queue.

## Numbers

The push gate on this repository, run Tuesday Oct. 27th, 2026: 2025 of 2025 tests, all passing. Day 1 ended at 498.

## Not built yet

A deploy, so no walk has gone from a phone through the whole pipeline, and no test yet runs a walk from the pipeline to the phone's results screen. Two live test runs went to SAM 3.1 and Muse Spark: asking SAM for the dry brush or the fence by phrase found neither ($0.16), while asking Muse Spark for a box first and tracking it with SAM found both on the synthetic yard ($0.1768). Muse Voice Transcribe and Muse Image are not built.
