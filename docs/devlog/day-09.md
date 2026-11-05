# Day 9: Tuesday Nov. 3rd, 2026

The ninth day gave the phone app the website's look, a sign in by emailed code and reminder emails for the next walk. It also put the apartment and the mobile home through Meta's models end to end, after the hero house, and published a proof of all three that anyone can rerun with no keys.

## Built

- **The app takes the website's look**: a dark top band, bordered cards and a bar of tabs along the bottom. Home is a dashboard showing when the next walk is due, and Walks, Settings and Results follow the same look, with Results showing findings first.
- **Each finding once**: Results lists the findings to fix first, then only the findings not in that list, by distance, so no finding shows twice.
- **One screen, no scrolling**: screens that hold a little more than a phone's height now fit one iPhone screen at 390 by 844 pixels, and no button is smaller than 44 pixels, even at the iPhone's largest text.
- **Sign in by code**: a homeowner types their email and gets a 6 digit code, with no password. The phone stays signed in for a rolling year, a new email address is confirmed by a code sent to it, and the app installs to the Home Screen with its own icons.
- **Reminder emails**: the next walk is due April 1, before fire season, and after the first three fixes the app asks for a walk to confirm them. A yearly reminder and a reminder for that walk go by email. The emails carry the EmberWalk look, and each one has a one tap way to turn them off, as does Settings.
- **Read aloud**: the guided walk reads each step aloud, only while the microphone is off, so the app's voice never lands in a finding's notes. A During Your Walk switch in Settings turns it off.
- **A clearer report**: the report shows the day the homeowner approved it, on screen and in the PDF. Download PDF never stays stuck when saving fails, and portrait photos get tall cards.
- **A walk that will not send says why**: Send Your Walk names what failed.
- **Dry grass, counted plainly**: one finding per distance band around the whole house, with its sides named. Leaves on the roof and a branch over it are placed at the house, never dropped.
- **The website**: its pages rewritten in English and Spanish the way an outside reader asked.
- **Payments**: the switch for live card payments on the plans is built, with live payment settings in place, and turned on with the next morning's deploy.
- **The judges' steps**: the README opens with four plain steps for judges: the website, the judges' portal, the app with its sign in, and the proof command.

## The three house proof

Each sample house was built in Blender with an answer key and has gone through SAM 3.1, Muse Spark and Muse Image end to end. One command, `npm run proof -w packages/sample-import`, replays the stored answers through the live walk's scoring, with no keys and no spend:

- The hero house: SAM 3.1 tracked the wood pile against the wall, the leaves in the front gutter, the branch over the left of the roof, the dry brush, the propane tank, the trash cans and the dry grass at the foundation on every side; the app measured each from the wall, Muse Spark wrote its fix in plain words, and Muse Image previewed the top three fixed.
- The apartment: SAM 3.1 tracked the dry brush in front, the wood pile and the tall grass at the back, the trash cans and the patio furniture, each measured, explained and previewed the same way.
- The mobile home: SAM 3.1 tracked the dry grass along the skirting, the propane tank, the trash cans, the wood pile and the shed at the back, each measured, explained and previewed the same way.

Real phone footage is the next step.

## Numbers

The full test run at the day's last landing, Tuesday Nov. 3rd, 2026: 7,496 tests, all passing. The three sample house runs on Meta's models, the hero house's on Monday and the other two on Tuesday: 502 calls, $13.19.
