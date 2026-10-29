# Day 4: Thursday Oct. 29th, 2026

The fourth day added a second part to the walk that pans the yard from each side, measured the light on every side, and set the pipeline to look for every object on the list.

## Built

- **Two part walk**: after the loop around the house, a Pan the Yard button asks the homeowner to stand at each side in turn, face the yard and turn slowly from one end to the other, in the order the loop walked them, with up to four pans. The loop is cut into its sides, and each part is sent labelled with its side.
- **Light on each side**: the phone measures how bright the picture is while recording, and each side is averaged on a scale of 0 to 255. A side that averages under 40 is too dark to check and is asked for again in daylight, by name, with the line "Walk the front side again when there's more daylight." Only that side is filmed again.
- **A fully checked walk**: each side is marked checked, partly checked or not checked. A walk that comes back to its start, pans four different sides in good light, shows the base of the wall and has every object checked, with nothing to fix, shows Ready for Inspection.
- **Each side by name**: the phone asks for each side it still needs, one at a time, even when all four are missing, and never for the whole walk again.
- **Checking screen**: five stages, Sent, Ready, Looking, Writing and Done, with a bar and a count such as "3 of 8 steps done". At the end it says "Checked. Opening what EmberWalk found." and opens the results. With reduced motion turned on, the trail holds still.
- **Fix first list**: every open finding within 30 feet of the house, nearest first, each with its distance, such as "About 1 foot from the house." Two lines above the list count the items inside 5 feet and from 5 to 30 feet. When nothing open is within 30 feet, the list shows what keeps the walk from green, nearest first.
- **The full object list**: every walk looks for all 25 objects on the loop and on the pans, within the day's spending cap.
- **Rules by state**: California's rules live in one data file, ready for more states beside it, and adding a state leaves California's answers as they are. New rows cover branches within 10 feet of a chimney outlet and the first 5 feet beside the house's wall.
- **Centred layout**: headings, card titles, labels and captions are centred on every phone screen, and the walk card on Home too. Running text starts at the column's edge, and the layout is checked at phone width.

## Numbers

The full test run, Thursday Oct. 29th, 2026: 3,455 tests, all passing. Day 3 ended at 3,118.
