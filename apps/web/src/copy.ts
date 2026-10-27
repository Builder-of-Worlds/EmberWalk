import { DEFAULT_LIMITS } from "@emberwalk/shared";
import type { Concept } from "@emberwalk/shared";
import type { Failure } from "./api.ts";
import type { Jurisdiction } from "./location.ts";
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
};

export const draft = {
  home: { lead: "Film one walk around your house. EmberWalk checks what could carry fire to it." },
  how: { asks: "It will ask for three things, each only when it's needed:" },
  rules: {
    title: "Which Fire Rules Apply",
    finding: "Finding the fire rules for your house.",
    found: "Your phone's location is in California. Check the rules below, then tap Use These Rules.",
    outside: "Your phone's location is outside California. EmberWalk knows California's rules only. Pick one if your house is in California.",
    refused: "EmberWalk could not use your location. Pick the fire rules for your house.",
    choices: {
      ca: "California: both State Responsibility Area and Very High Fire Hazard Severity Zone rules. Pick this if you are not sure.",
      ca_sra: "California State Responsibility Area (PRC 4291)",
      ca_vhfhsz: "California Very High Fire Hazard Severity Zone, local rules (Gov. Code 51182)",
    } satisfies Record<Jurisdiction, string>,
    confirm: "Use These Rules",
  },
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

export const unbacked = {
  results: { notChecked: (concept: Concept) => `Not checked on this walk: ${CONCEPT_WORDS[concept]}.` },
  leaves: {
    kept: "Kept: blurred photos and short blurred clips of what was found. Your original video is deleted as soon as it's checked.",
    location:
      "Location: used on your phone to find your fire rules and help nearby. To show the aerial photo, the map point of your house is sent to Esri, the map provider. Your address is never sent.",
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
    walkAgain: "Walk Again",
    soFar: "What We Found So Far",
    fixFirst: (count: number) => (count === 1 ? "Fix This First" : `Fix These ${count} First`),
    startHere: "Start here: closest to your house, and required by your rules or inside the first 5 feet.",
    bands: { zone_0: "First 5 Feet", zone_1: "5 to 30 Feet", zone_2: "30 to 100 Feet" },
    simple: "Simple",
    detailed: "Detailed",
    views: "Simple · Detailed",
    sample: "Synthetic sample house",
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
    location: "Location, to find the fire rules for your house and help nearby.",
    continue: "Continue",
  },
  record: {
    title: "Record Your Walk",
    back: "Back",
    ready: "Start at your front door, about three big steps from the wall. Walk all the way around the house.",
    limit: `A walk can be up to ${LIMIT_MINUTES} minutes long.`,
    start: "Start Recording",
    opening: "Opening the camera.",
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
    savedMinutes: (minutes: number) =>
      `${minutes} ${minutes === 1 ? "minute" : "minutes"} saved on this phone.`,
    refused: {
      offline: "Waiting for signal.",
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
