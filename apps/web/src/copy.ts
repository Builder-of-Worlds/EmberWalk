import { DEFAULT_LIMITS } from "@emberwalk/shared";
import type { Concept, WalkState } from "@emberwalk/shared";
import type { Failure } from "./api.ts";
import type { FeetSaid } from "./distance.ts";
import type { StatusKind } from "./finding-marks.ts";
import type { Gap, Label, Side } from "./results.ts";

const LIMIT_MINUTES = Math.floor(DEFAULT_LIMITS.maxWalkSeconds / 60);
const SEND = "Send My Walk";
const STAYS = "Your walk is still saved on this phone.";
const START_AGAIN = `Sending stopped. ${STAYS} Tap ${SEND} to start sending again.`;
const TRY_AGAIN = `Sending paused. ${STAYS} Tap ${SEND} to try again.`;

export const clockText = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const WALK_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const walkDate = (ms: number): string => WALK_DATE.format(ms);

const LONG_DATE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", year: "numeric", timeZone: "UTC" });

const ordinal = (day: number): string => {
  const tens = day % 100;
  if (tens > 10 && tens < 14) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
};

export const longDate = (day: Date): string => {
  const parts = Object.fromEntries(LONG_DATE.formatToParts(day).map((p) => [p.type, p.value]));
  return `${parts.weekday}, ${parts.month} ${ordinal(day.getUTCDate())}, ${parts.year}`;
};

const GAP_LINES: Record<Gap["kind"], (side: Side) => string> = {
  missing: (side) => `The ${side} side isn't in your video yet.`,
  dark: (side) => `The ${side} side is too dark to check.`,
  first_five_feet: (side) => `The first five feet on the ${side} side isn't in view yet.`,
  not_checked: (side) => `The ${side} side still needs checking.`,
};

const titled = (side: Side): string => `${side[0]!.toUpperCase()}${side.slice(1)}`;

const stepLine = (state: WalkState): string => {
  if (state.name !== "processing" || state.step === "prepare") return "Getting your walk ready to check.";
  if (state.step === "explain") return "Writing down what to do about each thing found.";
  return "Looking for what needs clearing.";
};

export const draft = {
  home: { lead: "Film one walk around your house. EmberWalk checks what could carry fire to it." },
  record: {
    corners: ["Start at the front door.", "Turn the first corner.", "Turn the next corner.", "One corner to go.", "Back at the front. Tap Stop Recording."],
    propertyLine: "Point the phone at your property line, then tap Property Line.",
  },
  results: {
    distance: (feet: number) => `About ${feet} feet from the house.`,
    confidence: (share: number) => `EmberWalk is ${Math.round(share * 100)}% sure of this.`,
  },
} as const;

const CONCEPT_WORDS: Record<Concept, string> = {
  dry_brush: "dry brush",
  wood_pile: "wood piles",
  wooden_fence: "wooden fences",
  roof_debris: "leaves and needles on the roof",
  foundation_vent: "vents",
  house_wall: "the house walls",
  tree_branch_over_roof: "branches over the roof",
  chimney: "the chimney",
  shrub: "shrubs",
  tree: "trees",
  dry_grass: "dry grass",
  propane_tank: "propane tanks",
  shed: "sheds",
  trash_can: "trash cans",
  patio_furniture: "patio furniture",
};

const distanceLine = (said: FeetSaid): string => {
  switch (said.kind) {
    case "against":
      return "Against the house.";
    case "within":
      return `Within ${said.high} ${said.high === 1 ? "foot" : "feet"} of the house.`;
    case "about":
      return `About ${said.feet} feet from the house.`;
    case "range":
      return `About ${said.low} to ${said.high} feet from the house.`;
  }
};

const thingsToClear = (count: number): string => (count === 0 ? "nothing found." : `${count} ${count === 1 ? "thing" : "things"} to clear.`);

export const unbacked = {
  leaves: {
    location:
      "Location: used on your phone to find your fire rules and help nearby. To show the aerial photo, the map point of your house is sent to Esri, the map provider. Your address is never sent.",
  },
  results: {
    lead: "Start here: closest to your home first, out to 30 feet.",
    distance: distanceLine,
    inside: (count: number) => `Inside 5 feet: ${thingsToClear(count)}`,
    out: (count: number) => `From 5 to 30 feet: ${thingsToClear(count)}`,
  },
} as const;

export const copy = {
  app: { name: "EmberWalk", offline: "No signal. EmberWalk still works on this phone." },
  home: {
    title: "EmberWalk",
    walk: "Walk My House",
    walks: "Your Walks",
    send: SEND,
    sample: "See a Sample House",
  },
  results: {
    ready: "Ready for Inspection",
    allClear: "All clear on everything EmberWalk could see.",
    insurance: "California requires insurers to offer discounts for some of this work. Ask yours what proof they need.",
    incomplete: "Walk Incomplete",
    gap: ({ side, kind }: Gap) => GAP_LINES[kind](side),
    hint: {
      walk_side: (side) => `Walk the ${side} side, from one corner to the next.`,
      more_light: (side) => `Walk the ${side} side again when there's more daylight.`,
      tilt_down: (side) => `Walk the ${side} side again with the phone tipped down a little, so the ground by the wall shows.`,
      step_back: (side) => `Walk the ${side} side again one step further from the wall, so the ground by the wall shows.`,
      again: (side) => `Walk the ${side} side once more. Your video was fine; EmberWalk needs another look.`,
    } satisfies Record<Gap["hint"], (side: Side) => string>,
    walkAgain: "Walk Again",
    walkSide: (side: Side) => `Walk the ${titled(side)} Side`,
    soFar: "What We Found So Far",
    fixFirst: (count: number) => (count === 1 ? "Fix This First" : `Fix These ${count} First`),
    notChecked: (concept: Concept) => `Not checked on this walk: ${CONCEPT_WORDS[concept]}.`,
    bands: { zone_0: "First 5 Feet", zone_1: "5 to 30 Feet", zone_2: "30 to 100 Feet" },
    simple: "Simple",
    detailed: "Detailed",
    views: "Simple · Detailed",
    walked: (day: Date) => `Walked ${longDate(day)}.`,
    old: "Over a year old. Walk again to update.",
    label: { required_now: "Required Now", recommended: "Recommended" } satisfies Record<Label, string>,
  },
  status: {
    kind: { needs_fixing: "Needs Fixing", fix_planned: "Fix Planned", done: "Done" } satisfies Record<StatusKind, string>,
    rechecked: "Rechecked",
    notRechecked: "Not rechecked yet",
    note: "Add a Note (optional)",
    example: "For example: tree crew coming Saturday.",
    save: "Save",
  },
  finding: {
    more: "More",
    source: "Where This Comes From",
    said: "What You Said",
    notRight: "This Isn't Right",
    removed: "Removed from your list.",
    undo: "Undo",
  },
  how: {
    title: "How Your Walk Works",
    walk: "Walk once around your house with your phone held up, about three big steps from the wall. EmberWalk guides you corner by corner.",
    asks: "It will ask for four things, each only when it's needed:",
    camera: "Camera, to film your walk.",
    microphone: "Microphone, so you can say what you see. You can turn sound off anytime.",
    motion: "Motion, to keep track of where you are on your walk.",
    location: "Location, so EmberWalk knows which fire rules apply to your house.",
    continue: "Continue",
  },
  record: {
    title: "Record Your Walk",
    back: "Back",
    ready: "Start at your front door, about three big steps from the wall. Walk all the way around the house.",
    oneSide: (side: Side) => `Stand at the corner where the ${side} side starts. Walk to the next corner, then tap Stop Recording.`,
    limit: `A walk can be up to ${LIMIT_MINUTES} minutes long.`,
    start: "Start Recording",
    opening: "Opening the camera.",
    location: {
      finding: "Looking up where your house is.",
      found: "Your house is in California, so EmberWalk uses the state's fire rules.",
      outside: "EmberWalk covers California's fire rules today, and checks your walk against them. More states are on the way.",
      refused: "Your walk is checked against California's fire rules.",
    },
    stop: "Stop Recording",
    soundOff: "Sound Off",
    pause: "Pause",
    propertyLine: "Property Line",
    timeLeft: (ms: number) => `${clockText(ms)} left`,
    saved: "A walk is saved on this phone and has not been sent yet.",
    sendSaved: "Send My Walk",
    recordAgain: "Delete It and Record Again",
    denied:
      "EmberWalk cannot use the camera because permission was turned off. Allow the camera for this website in your phone's settings, then tap Try Again.",
    unsupported: "This browser cannot record a walk for EmberWalk. Try Safari on iPhone or Chrome on Android.",
    failed: "The camera did not start. Tap Try Again.",
    tryAgain: "Try Again",
  },
  leaves: {
    title: "What Leaves Your Phone",
    sent: "Sent: your walk video, and its sound if sound was on. It goes to EmberWalk's storage and to Meta's AI, which looks for what needs clearing.",
    never: "Never sent: your name, your address or your contacts.",
    meta: "Meta does not use your walk to train its AI. EmberWalk sets your upload at Meta to delete itself within an hour and asks Meta not to save its answers.",
    send: SEND,
    notNow: "Not Now",
    later: "Your walk stays on this phone. You can send it later from Your Walks.",
  },
  send: {
    title: "Send Your Walk",
    back: "Back",
    saved: "Your walk is saved on this phone.",
    limitReached: `Recording stopped at the ${LIMIT_MINUTES} minute limit.`,
    cameraStopped: "Recording stopped early because the camera stopped. What was recorded is saved.",
    none: "There is no walk on this phone to send.",
    recordWalk: "Record a Walk",
    sending: (sentBytes: number, totalBytes: number) =>
      `Sending your walk. ${totalBytes > 0 ? Math.floor((100 * sentBytes) / totalBytes) : 0}% sent.`,
    sent: "Your walk was sent.",
    lost: "EmberWalk can no longer find this walk. Please record the walk again.",
    held: "EmberWalk is still working on your walk. This page updates by itself.",
    reported: "EmberWalk was told about the problem. This page updates by itself.",
    step: (state: WalkState) => stepLine(state),
    savedMinutes: (minutes: number) =>
      `${minutes} ${minutes === 1 ? "minute" : "minutes"} saved on this phone.`,
    refused: {
      offline: "Waiting for Signal.",
      invalid_size: "This walk has no video in it. Record the walk again.",
      too_large: "This walk is longer than a walk may be. Record a shorter walk.",
      too_many_parts: "This walk is longer than a walk may be. Record a shorter walk.",
      invalid_part_number: START_AGAIN,
      too_many_tries: `Part of your walk did not go through after several tries. ${STAYS} Tap ${SEND} to start sending again.`,
      upload_expired: `Sending took too long and was stopped. ${STAYS} Tap ${SEND} to start sending again.`,
      upload_completed: "This walk was already sent.",
      upload_aborted: START_AGAIN,
      unknown_upload: START_AGAIN,
      walk_not_uploading: "This walk was already sent.",
      parts_invalid: `Part of your walk did not arrive whole. ${STAYS} Tap ${SEND} to start sending again.`,
      invalid_request: TRY_AGAIN,
      body_too_large: TRY_AGAIN,
      unknown_walk: "This walk can't be sent anymore. Record the walk again.",
      upload_in_progress: `This walk is already being sent. ${STAYS} Try again later.`,
      not_mp4: "This video cannot be checked. Record the walk again.",
      not_found: TRY_AGAIN,
      method_not_allowed: TRY_AGAIN,
      spend_cap_reached: `EmberWalk has checked all the walks it can today. ${STAYS} Try again tomorrow.`,
      walk_limit_reached: `You have sent as many walks as EmberWalk allows today. ${STAYS} Try again tomorrow.`,
      walk_not_done: "This walk is still being checked.",
      rate_limited: `Too many tries in a short time. ${STAYS} Wait a minute, then tap ${SEND}.`,
      server_error: TRY_AGAIN,
    } satisfies Record<Failure, string>,
  },
} as const;
