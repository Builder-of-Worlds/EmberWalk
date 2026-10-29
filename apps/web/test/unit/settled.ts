export const SETTLED_HOME = ["EmberWalk", "Walk My House", "See a Sample House", "Your Walks", "Send My Walk"];

export const SETTLED_HOW = [
  "How Your Walk Works",
  "Walk once around your house with your phone held up, about three big steps from the wall. EmberWalk guides you corner by corner.",
  "It will ask for four things, each only when it's needed:",
  "Camera, to film your walk.",
  "Microphone, so you can say what you see. You can turn sound off anytime.",
  "Motion, to keep track of where you are on your walk.",
  "Location, so EmberWalk knows which fire rules apply to your house.",
  "Continue",
];

export const SETTLED_LEAVES = [
  "What Leaves Your Phone",
  "Sent: your walk video, and its sound if sound was on. It goes to EmberWalk's storage and to Meta's AI, which looks for what needs clearing.",
  "Never sent: your name, your address or your contacts.",
  "Location: used on your phone to find your fire rules and help nearby. To show the aerial photo, the map point of your house is sent to Esri, the map provider. Your address is never sent.",
  "Meta does not use your walk to train its AI. EmberWalk sets your upload at Meta to delete itself within an hour and asks Meta not to save its answers.",
  "Send My Walk",
  "Not Now",
  "Your walk stays on this phone. You can send it later from Your Walks.",
];

export const SETTLED_CHECKING = {
  stages: ["Sent", "Ready", "Looking", "Writing", "Done"],
  counted: "7 of 14 steps done",
  checked: "Checked. Opening what EmberWalk found.",
};

export const SEND_REWRITES = {
  tryAgain: "Sending paused. Your walk is still saved on this phone. Tap Send My Walk to try again.",
  unknownWalk: "This walk can't be sent anymore. Record the walk again.",
  walkNotUploading: "This walk was already sent.",
};

export const SEND_AFTER = {
  lost: "EmberWalk can no longer find this walk. Please record the walk again.",
  held: "EmberWalk is still working on your walk. This page updates by itself.",
  reported: "EmberWalk was told about the problem. This page updates by itself.",
};

export const SETTLED_LOCATION = {
  finding: "Looking up where your house is.",
  found: "Your house is in California, so EmberWalk uses the state's fire rules.",
  outside: "EmberWalk covers California's fire rules today, and checks your walk against them. More states are on the way.",
  refused: "Your walk is checked against California's fire rules.",
};

export const SETTLED_RESULTS = [
  "Ready for Inspection",
  "All clear on everything EmberWalk could see.",
  "Walk Incomplete",
  "Walk Again",
  "What We Found So Far",
  "Fix This First",
  "Fix These 2 First",
  "Fix These 3 First",
  "Start closest to your home: the first 5 feet matter most, then out to 30 feet, then 100.",
  "Inside 5 feet: nothing found.",
  "Inside 5 feet: 1 thing to clear.",
  "Inside 5 feet: 2 things to clear.",
  "From 5 to 30 feet: nothing found.",
  "From 5 to 30 feet: 1 thing to clear.",
  "From 5 to 30 feet: 2 things to clear.",
  "From 5 to 30 feet: 3 things to clear.",
  "First 5 Feet",
  "5 to 30 Feet",
  "30 to 100 Feet",
  "Simple",
  "Detailed",
  "California requires insurers to offer discounts for some of this work. Ask yours what proof they need.",
  "Over a year old. Walk again to update.",
  "Required Now",
  "Recommended",
];

export const SETTLED_DISTANCE = [
  "Against the house.",
  "Within 1 foot of the house.",
  "Within 3 feet of the house.",
  "About 1 foot from the house.",
  "About 2 feet from the house.",
  "About 12 feet from the house.",
  "About 12 to 19 feet from the house.",
];

export const SETTLED_NOT_CHECKED = {
  roof_debris: "Not checked on this walk: leaves and needles on the roof.",
  wood_pile: "Not checked on this walk: wood piles.",
} as const;

export const SETTLED_FINDING =["More", "Where This Comes From", "This Isn't Right", "Removed from your list.", "Undo"];

export const SETTLED_STATUS = ["Needs Fixing", "Fix Planned", "Done", "Rechecked", "Not rechecked yet", "Add a Note (optional)", "Save"];

export const SETTLED_GAPS = [
  "The back side isn't in your video yet.",
  "The left side is too dark to check.",
  "The first five feet on the right side isn't in view yet.",
];

export const SETTLED_SIDE = {
  notChecked: "The back side still needs checking.",
  walk: { front: "Walk the Front Side", right: "Walk the Right Side", back: "Walk the Back Side", left: "Walk the Left Side" },
  record: "Stand at the corner where the back side starts. Walk to the next corner, then tap Stop Recording.",
} as const;

export const SETTLED_HINTS = {
  walk_side: "Walk the back side, from one corner to the next.",
  more_light: "Walk the back side again when there's more daylight.",
  tilt_down: "Walk the back side again with the phone tipped down a little, so the ground by the wall shows.",
  step_back: "Walk the back side again one step further from the wall, so the ground by the wall shows.",
  again: "Walk the back side once more. Your video was fine; EmberWalk needs another look.",
} as const;

export const NEVER_LABELLED = /synthetic/i;

export const NEVER_SAID = ["we missed", "passed", "certified"];

export const OFF_SCREEN =["English · Español", "Español"];

export const shownLines = (host: HTMLElement): string[] =>
  [...host.querySelectorAll("h1, h2, p, li > span, li:not(:has(*)), a, button")]
    .map((el) => el.textContent?.trim() ?? "")
    .filter((text) => text !== "");
