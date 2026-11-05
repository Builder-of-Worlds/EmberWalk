# EmberWalk

Wildfire defensible space checks from one phone video, using Meta SAM 3.1 and Muse on Cloudflare.

## For judges

1. **The website:** https://emberwalk.app, with its opening film.
2. **The judges' portal:** https://judges.emberwalk.app, open to anyone all day on Wednesday Nov. 4th, 2026, with no sign in. Tap Watch the Judges' Video for the full film, or watch a shortened walk around a made-up sample house and go on to that house's results in a copy of the phone app.
3. **Try the app:** open https://go.emberwalk.app on a phone. Tap See a Sample House to see results without filming. To sign in, tap Sign In, type your email and tap Send My Code, then type the 6 digit code from the email. The code ends in 15 minutes, and the same email has a link that signs you in on that phone. There is no password.
4. **Check the proof yourself:** in a copy of this repository, run `npm install`, then `npm run proof -w packages/sample-import`. It replays what Meta's models answered for the four made-up houses and scores each against its answer key, with no keys and no spend. See "How we know it works" below.

**Status, Tuesday Nov. 3rd, 2026:** the phone app, the homeowner's report, Get It Fixed, plans for homeowners and for landlords and property managers, the Spanish version of the app and the website, and the website's pages are built and tested.

## What it does

The homeowner films one walk around the house, and EmberWalk finds what could carry fire to the house and ranks what to fix first, with the California rule behind each item.

As of Tuesday Nov. 3rd, 2026:

- **Film one walk.** The loop around the house is followed by a pan of the yard from each side, tagged by corner, and one side or corner can be filmed again on its own. When one part of a walk cannot be checked, the rest is still scored. Walks upload while they are recorded and pick up again when signal returns, and the phone keeps each walk's video, so a house is never walked twice.
- **What the app finds.** All 25 objects on the list, from dry brush and fences to gas cans, grills and wooden decks, each at a published source's distance.
- **How results look.** Required Now first, with a fix first list. The house is drawn from above with rings at 5, 30 and 100 feet and a numbered pin for each finding. See It Fixed previews the top three findings fixed, labelled as an AI preview. Where the cited source does not give a detail, the line is marked "Our advice, not a rule".
- **The homeowner's report.** The findings to fix first, each with its blurred photo and a dated record, approved by the homeowner before it is printed. A share link opens the approved report and nothing else, and can be turned off at any time.
- **Get It Fixed.** The homeowner enters a ZIP code and sees licensed crews for each kind of work, closest first. Nothing is sent until the homeowner approves it.
- **Defensible space record.** Each finding is marked Needs Fixing, Fix Planned or Done, with its date. One photo of a spot marked Done confirms the fix.
- **Landlords and property managers.** Your Homes shows every building and what is still open. A landlord can send a tenant a link that walks one house without an account, and the walk arrives on that house.
- **Privacy.** Delete Everything erases every walk, photo and report a phone has made, after one confirmation. A household's records are deleted 12 months after its last walk or plan.
- **Plans.** Yearly plans for homeowners and for landlords and property managers, with extra walks that carry over. A refund of a plan in full also cancels its renewal, and the person is emailed before a plan renews, with a link to cancel.
- **Spanish.** The app, the report and the website are available in English and Spanish.

## How it works

```
phone app ──upload in parts──> R2
    │                          │
    └──> API Worker ──starts──> pipeline (Workflows)
                                   ├─> media Container (ffmpeg: clip, audio, stills)
                                   ├─> SAM 3.1 (find each object in the walk)
                                   ├─> Muse Spark (judge each finding against the rule)
                                   └─> D1 (walks, findings, report)
```

Every sample house shown in this project is made up: no real house, address or person.

The judge copy is a build of the phone app that plays one recorded sample walk and shows that sample house's results, with no API behind it. It is served at `judges.emberwalk.app` by its own Worker (`workers/judges/`), open without a sign-in. `scripts/deploy.sh` builds the app and deploys the Workers in a fixed order; `scripts/worker-boot.sh` boots each one locally before a deploy.

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

## How we know it works

Everything in this repository was built during the hackathon, Monday Oct. 26th to Wednesday Nov. 4th, 2026. EmberWalk is a working prototype, proven on made-up houses.

**The houses.** We built four synthetic houses in Blender from a written spec (`blender/`): the hero house (a whole house, all four sides), an apartment, a mobile home, and the walled house, the hero house again with a wall and two fences closing its right side yard, so a walk cannot film that side. Because every hazard is placed by the spec, each house comes with an answer key, `fixtures/synthetic/<house>/truth.json`, that says what each hazard is, where it stands, how far it is from the wall and which distance band it falls in. Blender also renders the phone style walk around each house. No real house, address or person is in any of them.

**Which houses went through Meta's models.** All four, each in one walk end to end through the real pipeline on SAM 3.1, Muse Spark and Muse Image:

- The hero house, walk `65faff97`, the night of Monday Nov. 2nd, 2026: 290 calls, $4.80.
- The apartment, walk `dbd505ac`, the night of Tuesday Nov. 3rd, 2026: 103 calls, $4.80.
- The mobile home, walk `25f98828`, the night of Tuesday Nov. 3rd, 2026: 109 calls, $3.59.
- The walled house, walk `07f96d7c`, the morning of Wednesday Nov. 4th, 2026: 106 calls, $3.95. Nothing was tuned on it; it is the held out test.

**The stored answers.** What came back from each walk is in `fixtures/synthetic/<house>-final/meta-run.json`, and for the walled house `fixtures/synthetic/hero-walled/meta-run.json` (hero 1.9 MB, apartment 1.1 MB, mobile home 1.2 MB, walled house 1.8 MB): the walk's two clips, its route tags, SAM 3.1's tracks with a box and a confidence on each frame, and the calls and cost of each Meta step. Each answer key is `truth.json` beside it (hero 3.2 MB, apartment 1.3 MB, mobile home 1.2 MB, walled house 2.1 MB).

**Run it yourself.** One command replays the stored answers through the same scoring code the live pipeline runs after SAM, and scores each house against its answer key. It needs no keys, makes no network call and spends nothing:

```sh
npm run proof -w packages/sample-import
```

Our run, Wednesday Nov. 4th, 2026:

- The hero house: found 15 of its 20 hazards; 33 findings, 22 of them extra findings not in the answer key; 14 of the 15 found are in the right distance band; 1 of the answer key's top three is in the app's Fix These 3 First. Missed, all on the right side: the wooden fence touching the wall, the leaves at a foundation vent, the dry brush by the garage, the branch by the chimney and the shed.
- The apartment: found 6 of its 12 hazards; 13 findings, 7 of them extra findings; 5 of the 6 found are in the right band; 1 of the top three is in the app's Fix These 3 First. Missed: the leaves in the back gutter, the leaves at a foundation vent on the left, the three branches over the roof and a shrub in front.
- The mobile home: found 7 of its 10 hazards; 18 findings, 12 of them extra findings; 6 of the 7 found are in the right band; 2 of the top three are in the app's Fix These 3 First. Missed: the leaves at the front foundation vent, the branch over the back of the roof and the dry brush on the right.
- The walled house: found 12 of its 20 hazards. 7 of the 20 stand in the right side yard behind the wall, where the walk cannot film; of the 13 it can film, it found 10. 22 findings, 13 of them extra findings; 9 of the 12 found are in the right band; 1 of the top three is in the app's Fix These 3 First. The app marks the whole walk "not checked" because the loop did not close; it does not name the right side yard as the part it missed. Missed on the sides it could film: the leaves in the front gutter, the branch over the left of the roof and the dry plants by the garage. Missed in the side yard: the fence touching the wall, the leaves at a foundation vent, the branch by the chimney, the propane tank and the trash cans.
- On no house is a top three item in the same place in the app's list.

Of the 17 hazards missed across the four houses on sides the walks could film, 11 sit on or over the roof or at a foundation vent.

The test `packages/sample-import/test/node/replay.test.ts` fails if a change to the rules moves any of these numbers. On a fresh copy of this repository with no keys set, `npm test` passed 6,557 tests (5,497 Vitest tests and 1,060 Blender scene tests), none failed or skipped, on Tuesday Nov. 3rd, 2026. Tests that call paid models, and tests written ahead of features not yet built, are not in that script.

Real phone footage is the next step.

## The story

Defensible space is the buffer a homeowner keeps between a house and the plants, wood and clutter that could carry fire to it. Checking it by hand means walking every side of the house with a checklist. EmberWalk aims to turn that walk into one phone video: film once, get a ranked list of what to fix, each item with the rule behind it and the picture that shows it.

EmberWalk is built during the Meta Global AI Developer Hackathon, Monday Oct. 26th to Wednesday Nov. 4th, 2026. This repository gets one commit a day, and each day has a short write-up in `docs/devlog/`.

| Day | Date | Built |
| --- | --- | --- |
| 1 | Monday Oct. 26th | Landing page with signup, the video upload API, the ffmpeg media Container, the Meta model client for SAM 3.1 and Muse Spark, the shared contracts and the synthetic house builder. [Write-up](docs/devlog/day-01.md) |
| 2 | Tuesday Oct. 27th | Phone screens, results screens, the walk pipeline steps, the rules engine and the privacy blur. [Write-up](docs/devlog/day-02.md) |
| 3 | Wednesday Oct. 28th | Results back on the phone, one side redone, the coverage check, the location step and plainer wording. [Write-up](docs/devlog/day-03.md) |
| 4 | Thursday Oct. 29th | The two part walk, light on each side, the checking screen's step counts, the full object list in the pipeline and rules by state. [Write-up](docs/devlog/day-04.md) |
| 5 | Friday Oct. 30th | Get It Fixed, See It Fixed and a second check built for test houses and kept off, the house drawn with its findings, rules for the newer objects, the walk sent while recorded and a first deploy made ready. [Write-up](docs/devlog/day-05.md) |
| 6 | Saturday Oct. 31st | The homeowner's report and share link, Delete Everything, a recheck photo, plans, an owner page and the website's pages. [Write-up](docs/devlog/day-06.md) |
| 7 | Sunday Nov. 1st | Spanish across the app, Your Homes for landlords, the walk dated by the phone's own day, a streamed sample walk on the judges' copy and steadier distances for objects against the wall. [Write-up](docs/devlog/day-07.md) |
| 8 | Monday Nov. 2nd | The renewal email before a plan renews, a refund that also cancels the renewal, "Our advice, not a rule" on the results, the landing page's opening and plans, and the Spanish words reviewed in a second AI pass. [Write-up](docs/devlog/day-08.md) |
| 9 | Tuesday Nov. 3rd | The app in the website's look, sign in by emailed code, reminder emails, the walk read aloud, each finding shown once, and the three house proof anyone can rerun. [Write-up](docs/devlog/day-09.md) |
| 10 | Wednesday Nov. 4th | The switch for real payments, even spacing and tab icons in the app, the right text size on a Mac, the website's last details, the judges' portal on the hero house's real walk, a fourth held out house through Meta's models, and the judges' film on the website and in the portal. [Write-up](docs/devlog/day-10.md) |

## License

Apache License 2.0 (`LICENSE`), except `blender/`, which is GPL 3.0 or later (`blender/LICENSE`), because Blender requires scripts that use its Python API to be GPL.

The landing page ships GSAP 3.15.0 (`workers/static/public/vendor/`), which is not under Apache 2.0. It is under the Standard "No Charge" GSAP License (https://gsap.com/standard-license, read Thursday Oct. 29th, 2026), which allows free use, commercial use included, and prohibits its use in tools that let users build visual animations without code. Its notice is in `NOTICE`.

Synthetic scene assets: Powered by Poly Haven (https://polyhaven.com), CC0.

The landing page photos and the synthetic house stills in `fixtures/synthetic/hero-look/` are AI generated with Google's Nano Banana Pro image model (nano-banana-pro), and the landing page's opening film frames with Kling (kling-v3). The phone screens on the landing page are screen captures of the app showing a synthetic sample walk. No real house or person is shown.
