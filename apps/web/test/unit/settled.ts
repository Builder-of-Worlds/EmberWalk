export const SETTLED_HOME = ["EmberWalk", "Walk My House", "See a Sample House", "Your Walks", "Send My Walk"];

export const SETTLED_HOW = [
  "How Your Walk Works",
  "Walk once around your house with your phone held up, about three big steps from the wall. EmberWalk guides you corner by corner.",
  "It will ask for four things, each only when it's needed:",
  "Camera, to film your walk.",
  "Microphone, so you can say what you see. You can turn sound off anytime.",
  "Motion, to keep track of where you are on your walk.",
  "Location, to find the fire rules for your house and help nearby.",
  "Continue",
];

export const SETTLED_LEAVES = [
  "What Leaves Your Phone",
  "Sent: your walk video, and its sound if sound was on. It goes to EmberWalk's storage and to Meta's AI, which looks for what needs clearing.",
  "Kept: blurred photos and short blurred clips of what was found. Your original video is deleted as soon as it's checked.",
  "Never sent: your name, your address or your contacts.",
  "Location: used on your phone to find your fire rules and help nearby. To show the aerial photo, the map point of your house is sent to Esri, the map provider. Your address is never sent.",
  "Meta does not use your walk to train its AI. EmberWalk sets your upload at Meta to delete itself within an hour and asks Meta not to save its answers.",
  "Send My Walk",
  "Not Now",
  "Your walk stays on this phone. You can send it later from Your Walks.",
];

export const SEND_REWRITES = {
  tryAgain: "Sending paused. Your walk is still saved on this phone. Tap Send My Walk to try again.",
  unknownWalk: "This walk can't be sent anymore. Record the walk again.",
  walkNotUploading: "This walk was already sent.",
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
  "Start here: closest to your house, and required by your rules or inside the first 5 feet.",
  "First 5 Feet",
  "5 to 30 Feet",
  "30 to 100 Feet",
  "Simple",
  "Detailed",
  "Synthetic sample house",
  "California requires insurers to offer discounts for some of this work. Ask yours what proof they need.",
  "Over a year old. Walk again to update.",
  "Required Now",
  "Recommended",
];

export const SETTLED_FINDING = ["More", "Where This Comes From", "This Isn't Right", "Removed from your list.", "Undo"];

export const SETTLED_STATUS = ["Needs Fixing", "Fix Planned", "Done", "Rechecked", "Not rechecked yet", "Add a Note (optional)", "Save"];

export const SETTLED_GAPS = [
  "The back side isn't in your video yet.",
  "The left side is too dark to check.",
  "The first five feet on the right side isn't in view yet.",
];

export const NEVER_SAID = ["we missed", "passed", "certified"];

export const OFF_SCREEN =["English · Español", "Español"];

export const shownLines = (host: HTMLElement): string[] =>
  [...host.querySelectorAll("h1, h2, p, li > span, li:not(:has(*)), a, button")]
    .map((el) => el.textContent?.trim() ?? "")
    .filter((text) => text !== "");
