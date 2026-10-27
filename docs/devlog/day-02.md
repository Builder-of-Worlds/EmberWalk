# Day 2: Tuesday Oct. 27th, 2026

The second day put the phone app and the checking pipeline in place: the app records and sends a walk, and the pipeline finds hazards, places them around the house and ranks what to fix first.

## Built

- **Phone app**: Home, How Your Walk Works, and Record and Send. It records from the rear camera, keeps the take on the phone and sends the walk in parts. If the connection drops, the upload carries on from where it stopped, and a walk stopped by lost signal sends itself when signal returns. After the first visit the app opens offline, and no screen scrolls sideways on a phone.
- **Results**: Simple and Detailed views with Required Now first. A walk that was not fully covered is never shown as green. Every finding shows the rule behind it, and This Isn't Right sets one aside until Undo brings it back. The three newest results stay on the phone, so a homeowner can look again without sending anything. The sample houses can also be browsed in a copy of the app that needs no network, and each one is checked as synthetic when it loads.
- **Walk API**: starts a walk, stores what the phone noted, and starts the check once when the upload finishes. Status, results and proof photos answer only the phone that made the walk, so one household cannot see another's.
- **Walk pipeline**: cuts clips, finds objects with SAM 3.1, has Muse Spark point out dry brush and fences, tracks each one through the video and saves ranked findings. Running a walk twice gives the same findings, not doubled ones. The walk video is deleted when the check ends.
- **Rules engine**: 38 California rules, held as 74 rows by zone, each with its citation, turned into findings ranked fix first. A plant judged alive gets no dead fuel finding, and a scorer compares the findings with a sample house's known answers.
- **Privacy blur**: every proof photo is blurred before it is kept, up to 32 named regions in a single still, and each finding is worded in plain language.
- **Get It Fixed agent**: finds crews and drafts requests for the homeowner to read, and nothing is sent without the homeowner's approval. The database itself refuses to release a request that has not been approved.
- **Sample walk import**: sends a rendered sample walk through the real API as a phone would, then runs the first steps of the check on it. Every screen labels it a Synthetic sample house.
- **Synthetic sample houses**: a second test yard where the fence stays large in the frame for ten frames in a row, with a box for every hazard on every frame.
- **Database**: tables for clips, tags, detections, findings, costs, jobs and approvals.

## Numbers

The full test run, Tuesday Oct. 27th, 2026: 2,025 tests, all passing. Day 1 ended at 498.
