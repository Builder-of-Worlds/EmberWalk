# Day 4: Thursday Oct. 29th, 2026

The fourth day gave the walk a second part that pans each side of the yard; the phone now measures the light on each side, the checking screen counts the steps, and the pipeline asks for every object on the list. Everything below runs and is tested on a laptop; nothing is deployed yet.

## Built

- **Two part walk** (`apps/web/`, `packages/shared/`, `workers/api/`): after the loop around the house, a Pan the Yard button asks the homeowner to stand at each side in turn, face the yard and turn slowly from one end to the other, in the order the loop walked them, up to four pans. The phone sends the loop cut into its sides and each pan as its own part, each labelled with its side.
- **Light on each side** (`apps/web/`, `packages/rules/`, `workers/pipeline/`): while recording, the phone reads how bright the camera picture is with every compass sample, on a scale of 0 to 255. The coverage check averages it for each side and marks a side under 40 too dark; the phone then asks for that side alone with the line "Walk the front side again when there's more daylight." (the side named), and the redo sends that side's loop and pan only.
- **A walk can now be fully checked** (`packages/rules/`, `workers/pipeline/`): with light measured, the coverage check marks each side checked, partly checked or not checked, and marks the whole walk checked only when the loop came back to its start, four different sides were panned, every side had enough light and showed the base of the wall, and every object could be checked. The phone shows a fully checked walk with nothing to fix as Ready for Inspection. Tested in parts on a synthetic walk with recorded model answers; no single test yet runs one walk from the phone through to Ready for Inspection.
- **Each missed side on its own** (`apps/web/`): when results name sides the walk could not check, the phone asks for each one by name, even when all four are missing, and never asks for the whole walk again.
- **Checking screen with step counts** (`apps/web/`, `workers/pipeline/`, `packages/db/`, `migrations/0012_walk_progress.sql`): while the server checks a walk, the phone shows a trail of five stages: Sent, Ready, Looking, Writing and Done. The pipeline stores how many steps of the current stage are finished, and the phone shows that as a bar and a line such as "3 of 8 steps done". At the end it shows "Checked. Opening what EmberWalk found." for 1.5 seconds, then opens the results. With reduced motion the trail holds still.
- **Fix first list, every item** (`apps/web/`): the list now holds every open finding within 30 feet of the house, nearest first, with no cut, and each row says how far it is, such as "About 1 foot from the house." Two lines above it count the items inside 5 feet and from 5 to 30 feet. When nothing open is within 30 feet, the list shows what keeps the walk from green, nearest first.
- **The full object list in the pipeline** (`workers/pipeline/`, `packages/catalog/`): every walk now asks SAM 3.1 for all 25 objects on the list, the 10 new ones included, on both the loop and the pans, and checks the walk's estimated cost against the day's cap before the first call. The new objects are counted when seen but do not become findings yet, since they have no rule yet. Tested with recorded model answers only.
- **Rules by state** (`packages/rules/`): California's rule table is now one data file read through a state loader. A second state's file can be loaded beside it without changing any California answer, a state that is not loaded is refused, and a file with a broken distance band or a missing source date is refused. Only California is loaded today. The table also gains rows for branches within 10 feet of a chimney outlet and for the house wall's first 5 feet; the pipeline does not yet turn what it sees of either into a finding.
- **Centred layout** (`apps/web/`): headings, card titles, labels and captions on every phone screen, and the walk card on Home, are centred, and running text starts at the column's edge. A browser test measures each one at 390 pixels wide.

## Numbers

The push gate on this repository, run Thursday Oct. 29th, 2026: 3,455 of 3,455 tests, all passing. Day 3 ended at 3,118.

| Area | Tests |
| --- | --- |
| Synthetic sample houses (`blender`) | 579 |
| Phone app (`apps/web`) | 485 |
| Rules engine (`packages/rules`) | 371 |
| Build checks (`tools`) | 319 |
| Walk pipeline (`workers/pipeline`) | 303 |
| Meta model client (`packages/meta`) | 259 |
| Site (`workers/static`) | 234 |
| Walk and upload API (`workers/api`) | 203 |
| Plain wording (`packages/explain`) | 180 |
| Database (`packages/db`) | 147 |
| Contracts (`packages/shared`) | 104 |
| Sample walk import (`packages/sample-import`) | 99 |
| Media Container (`containers/media`) | 71 |
| Get It Fixed agent (`packages/agent`) | 57 |
| Object catalog (`packages/catalog`) | 38 |
| Upload signing (`packages/sigv4`) | 6 |

Live model spend since the last upload: none recorded.

## Not built yet

Nothing is deployed, so no walk has gone from a phone through the live pipeline. Voice notes and the Get It Fixed agent stay switched off. When a walk did not come back to its start or is missing pans, it is held back from Ready for Inspection, but the phone does not yet say why. Asking for one corner alone is not built. The new objects on the list have no rules yet, and Muse Image is not built.
