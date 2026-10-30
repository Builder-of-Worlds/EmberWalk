import { DEFAULT_LIMITS } from "@emberwalk/shared";
import type { Concept, Corner, FixedRouteCode, WalkState } from "@emberwalk/shared";
import type { Failure } from "./api.ts";
import type { FeetSaid } from "./distance.ts";
import type { StatusKind } from "./finding-marks.ts";
import { localDay } from "./mark-sync.ts";
import type { FixedFailure, JobStatus, Message, Trade } from "./fixed-api.ts";
import type { Stage } from "./progress.ts";
import type { Gap, Label, Side, SideGap } from "./results.ts";

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

const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

export const shortDay = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1] ?? ""} ${ordinal(day ?? 1)}, ${year}`;
};

const GAP_LINES: Record<Gap["kind"], (side: Side) => string> = {
  missing: (side) => `The ${side} side isn't in your video yet.`,
  dark: (side) => `The ${side} side is too dark to check.`,
  first_five_feet: (side) => `The first five feet on the ${side} side isn't in view yet.`,
  not_checked: (side) => `The ${side} side still needs checking.`,
};

const titled = (side: Side): string => `${side[0]!.toUpperCase()}${side.slice(1)}`;

const cornerWords = (corner: Corner): string => corner.replace("_", " ");

const titledCorner = (corner: Corner): string => corner.split("_").map((word) => titled(word as Side)).join(" ");

const stepLine = (state: WalkState): string => {
  if (state.name !== "processing" || state.step === "prepare") return "Getting your walk ready to check.";
  if (state.step === "explain") return "Writing down what to do about each thing found.";
  return "Looking for what needs clearing.";
};

const MILES = (miles: number): string => {
  const said = Number(miles.toFixed(1));
  return `${said} ${said === 1 ? "mile" : "miles"} away`;
};

const itemsOnList = (count: number): string => `For ${count} ${count === 1 ? "item" : "items"} on your list.`;

const TRADE_NAMES: Record<Trade, string> = {
  tree_service: "Tree Service",
  brush_clearing: "Brush Clearing",
  debris_hauling: "Debris Hauling",
  roofing_gutters: "Roofing and Gutters",
  fencing: "Fencing",
  handyman: "Handyman",
};

const JOB_LINES: Record<JobStatus, string> = {
  planning: "Crews are being picked for this work.",
  waiting_on_homeowner: "Waiting for your okay.",
  waiting_on_crew: "Waiting to hear back from the crews.",
  scheduled: "A crew has a time lined up with you.",
  done: "This work is done.",
  closed: "This work is closed.",
};

const SOMETHING_WRONG = "Something went wrong on EmberWalk's side. Try again in a minute.";

const PROBLEMS: Record<FixedRouteCode | "offline", string> = {
  offline: "No signal. Try again when you have signal.",
  rate_limited: "EmberWalk has done that as many times as it allows for now.",
  invalid_request: "EmberWalk could not read that. Check it and try again.",
  not_found: "EmberWalk could not find that. Go back and open it again.",
  method_not_allowed: SOMETHING_WRONG,
  conflict: "That cannot be done now.",
  not_ready: "Mark every Required Now item done first.",
  send_failed: "The email did not go out. Try again.",
  server_error: SOMETHING_WRONG,
};

const problemFor = (code: FixedFailure): string => (code in PROBLEMS ? PROBLEMS[code as keyof typeof PROBLEMS] : SOMETHING_WRONG);

const messageLine = (message: Pick<Message, "status" | "channel" | "outbox" | "sentAt">): string => {
  const sent = message.sentAt === null ? "" : ` on ${shortDay(localDay(Date.parse(message.sentAt)))}`;
  switch (message.status) {
    case "draft":
      return "Written and waiting for your okay.";
    case "approved":
      if (message.channel === "text") return "Approved. Waiting for you to send the text.";
      return message.outbox?.state === "failed" ? "Approved. The email did not go through yet." : "Approved. The email is on its way.";
    case "sent":
      return `Sent${sent}.`;
    case "sent_by_phone":
      return `Sent from your phone${sent}.`;
    case "replied":
      return "The crew replied.";
  }
};

export const draft = {
  portfolio: {
    title: "Your Homes",
    notWalked: "Not walked yet",
    ready: "Ready for Inspection",
    needsFixes: "Needs fixes",
    seeResults: "See Results",
    back: "Back to Home",
  },
  detail: {
    mapTitle: "Your House From Above",
    mapEmpty: "Nothing to place on the map yet.",
    backToResults: "Back to Your Results",
  },
  fixed: {
    title: "Get It Fixed",
    nothingGoesOut: "Nothing goes out without your okay.",
    zipLabel: "Your ZIP code",
    zipButton: "Find Licensed Crews",
    zipInvalid: "Enter a 5 digit ZIP code.",
    finding: "Finding licensed crews near your house.",
    trade: TRADE_NAMES,
    job: JOB_LINES,
    itemsOnList,
    noCrews: "No licensed crews were found near your house for this kind of work.",
    yourself: "Yours to Do",
    yourselfLine: "No crew on the list covers these. They are yours to do.",
    distance: (miles: number, approximate: boolean) => (approximate ? `about ${MILES(miles)}` : MILES(miles)),
    license: (status: string, listedOn: string | null) =>
      listedOn === null ? `License status ${status}` : `License status ${status} on the state list of ${shortDay(listedOn)}`,
    text: "Text",
    sample: "Sample crew",
    emailOf: (email: string) => `Email: ${email}`,
    addEmail: "Add Email",
    emailLabel: (name: string) => `Email for ${name}`,
    emailLocked: "A request is already written for this business, so its email can't change.",
    writeRequests: "Write My Requests",
    writing: "Writing your requests.",
    requests: "Requests",
    message: messageLine,
    review: "Review and Approve",
    replies: "Replies",
    replyVia: { email: "Reply by email", homeowner: "Reply you added" },
    read: "What EmberWalk read in it",
    price: (price: string) => `Price they mentioned: ${price}`,
    date: (date: string) => `Date they mentioned: ${date}`,
    questions: "Questions they asked",
    declined: "This crew said no.",
    logReply: "Log a Reply",
    replyLabel: "What the crew said",
    replyHelp: "Type or paste a reply that came by text or by phone.",
    replyEmpty: "Type what they said first.",
    reminders: "Reminders",
    reminderReady: (day: string) => `A reminder is ready. It was due ${day}.`,
    reminderDue: (day: string) => `Due ${day}.`,
    reviewReminder: "Review the Reminder",
    writeReminders: "Write My Reminders",
    remindersChecked: "Checked. Any reminders are listed under the requests.",
    inspection: "Draft My Inspection Request",
    inspectionLine: "When every Required Now item is Done, EmberWalk drafts an inspection request for you to send.",
    loading: "Getting this from EmberWalk.",
    tryAgain: "Try Again",
    backToFix: "Back to Get It Fixed",
    backToResults: "Back to Your Results",
    problem: problemFor,
  },
  approve: {
    title: "Approve This Request",
    byEmail: (email: string | null) => (email === null ? "This goes by email." : `This goes by email to ${email}.`),
    byText: (phone: string) => `This is sent by text from your phone to ${phone}.`,
    subject: (subject: string) => `Subject: ${subject}`,
    photos: "Photos That Go With It",
    nothingSent: "Nothing is sent until you tap the button below.",
    email: "Approve and Send",
    text: "Approve This Text",
    openText: "Open the Text",
    approvedText: "Approved. Nothing has been sent yet. Tap Open the Text to send it from your phone.",
    again: "Try Sending Again",
    sentEmail: "Your email was sent.",
    sentPhone: "Marked as sent from your phone.",
    sendFailed: "The email did not go through. Nothing was lost. Tap Try Sending Again.",
    notSent: "The text was not sent. Tap Open the Text when you are ready.",
    markAgain: "Tell EmberWalk It Was Sent",
    missing: "This request could not be found.",
  },
  history: {
    intro: "Every walk you have done and every mark you have made on its list, with the day.",
    empty: "No walks are on your record yet.",
    noMarks: "No marks on this walk yet.",
    mark: (kind: string, day: string) => `${kind} on ${day}`,
  },
  inspection: {
    title: "Your Inspection Request",
    intro: "This is a draft for you to read and send. EmberWalk does not schedule or carry out the inspection.",
    subject: (subject: string) => `Subject: ${subject}`,
    copy: "Copy",
    copied: "Copied.",
    copyFailed: "Could not copy. Press and hold the text to copy it yourself.",
    links: "Links to Include",
    writing: "Writing your request.",
    notReady: "Not Ready Yet",
    noRequired: "This walk has no Required Now item, so there is nothing to put in an inspection request.",
  },
  status: {
    doneDay: "The day it was done",
    doneOn: (iso: string) => `Done on ${shortDay(iso)}.`,
    willSave: "Saved on this phone. It will be saved to EmberWalk when you have signal.",
    refused: "EmberWalk could not save this mark to your record. It is still marked on this phone.",
    futureDay: "Pick today or an earlier day.",
  },
  home: { lead: "Film one walk around your house. EmberWalk checks what could carry fire to it." },
  record: {
    corners: ["Start at the front door.", "Turn the first corner.", "Turn the next corner.", "One corner to go.", "Back at the front. Tap Stop Recording."],
    propertyLine: "Point the phone at your property line, then tap Property Line.",
    pan: (side: Side) => `Stand at the ${side} side, face the yard and turn slowly from one end to the other. Tap Pan the Yard again when done.`,
  },
  guided: {
    now: (side: Side) => `Now the ${side} side. Tap Next at the corner.`,
    next: "Next",
    back: "Back at the front. Tap Pan the Yard at each corner, or Stop Recording.",
  },
  results: {
    confidence: (share: number) => `EmberWalk is ${Math.round(share * 100)}% sure of this.`,
  },
  corners: {
    gap: {
      missing: (corner: Corner) => `The ${cornerWords(corner)} corner isn't in your video yet.`,
      dark: (corner: Corner) => `The ${cornerWords(corner)} corner is too dark to check.`,
      first_five_feet: (corner: Corner) => `The first five feet at the ${cornerWords(corner)} corner isn't in view yet.`,
      not_checked: (corner: Corner) => `The ${cornerWords(corner)} corner still needs checking.`,
    } satisfies Record<Gap["kind"], (corner: Corner) => string>,
    hint: (corner: Corner) => `Stand at the ${cornerWords(corner)} corner and pan the yard, turning slowly from one side to the other.`,
    panCorner: (corner: Corner) => `Pan the ${titledCorner(corner)} Corner`,
    pan: (corner: Corner) =>
      `Stand at the ${cornerWords(corner)} corner, face the yard and turn slowly from one side to the other. Tap Pan the Yard again when done.`,
    oneCorner: (corner: Corner) =>
      `Stand at the ${cornerWords(corner)} corner and face the yard. Tap Pan the Yard, turn slowly from one side to the other, then tap it again.`,
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
  gas_can: "gas cans",
  stored_fuel: "stored fuel",
  lawn_mower: "lawn mowers",
  grill: "grills",
  propane_cylinder: "small propane cylinders",
  vehicle: "vehicles",
  lumber_pile: "lumber piles",
  tarp: "tarps",
  doormat: "doormats",
  boat_or_trailer: "boats and trailers",
  wood_deck: "wood decks",
};

export const conceptLabel = (concept: string): string => {
  const words = CONCEPT_WORDS[concept as Concept] ?? concept.replaceAll("_", " ");
  return `${words[0]!.toUpperCase()}${words.slice(1)}`;
};

const distanceLine = (said: FeetSaid): string => {
  switch (said.kind) {
    case "against":
      return "Against the house.";
    case "within":
      return `Within ${said.high} ${said.high === 1 ? "foot" : "feet"} of the house.`;
    case "about":
      return `About ${said.feet} ${said.feet === 1 ? "foot" : "feet"} from the house.`;
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
  pin: { side: (side: Side) => `The ${side} side.` },
} as const;

export const copy = {
  app: { name: "EmberWalk", offline: "No signal. EmberWalk still works on this phone." },
  home: {
    title: "EmberWalk",
    walk: "Walk My House",
    walks: "Your Walks",
    send: SEND,
    sample: "See a Sample House",
    progress: "See Progress",
  },
  results: {
    ready: "Ready for Inspection",
    allClear: "All clear on everything EmberWalk could see.",
    insurance: "California requires insurers to offer discounts for some of this work. Ask yours what proof they need.",
    incomplete: "Walk Incomplete",
    gap: ({ side, kind }: SideGap) => GAP_LINES[kind](side),
    hint: {
      walk_side: (side) => `Walk the ${side} side, from one corner to the next.`,
      more_light: (side) => `Walk the ${side} side again when there's more daylight.`,
      tilt_down: (side) => `Walk the ${side} side again with the phone tipped down a little, so the ground by the wall shows.`,
      step_back: (side) => `Walk the ${side} side again one step further from the wall, so the ground by the wall shows.`,
      again: (side) => `Walk the ${side} side once more. Your video was fine; EmberWalk needs another look.`,
    } satisfies Record<SideGap["hint"], (side: Side) => string>,
    walkSide: (side: Side) => `Walk the ${titled(side)} Side`,
    soFar: "What We Found So Far",
    fixFirst: (count: number) => (count === 1 ? "Fix This First" : `Fix These ${count} First`),
    lead: "Start closest to your home: the first 5 feet matter most, then out to 30 feet, then 100.",
    distance: distanceLine,
    inside: (count: number) => `Inside 5 feet: ${thingsToClear(count)}`,
    out: (count: number) => `From 5 to 30 feet: ${thingsToClear(count)}`,
    notChecked: (concept: Concept) => `Not checked on this walk: ${CONCEPT_WORDS[concept]}.`,
    bands: { zone_0: "First 5 Feet", zone_1: "5 to 30 Feet", zone_2: "30 to 100 Feet" },
    simple: "Simple",
    detailed: "Detailed",
    views: "Simple · Detailed",
    walked: (day: Date) => `Walked ${longDate(day)}.`,
    old: "Over a year old. Walk again to update.",
    label: { required_now: "Required Now", recommended: "Recommended" } satisfies Record<Label, string>,
  },
  fixed: {
    honest: "Every licensed business on California's public contractor list, closest first. EmberWalk doesn't rank or recommend them.",
    call: "Call",
    checkLicense: "Check This License",
  },
  history: { title: "Defensible Space Record" },
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
    seeFixed: "See It Fixed",
    aiPreview: "AI preview, not a photo",
    secondCheck: (reason: string) => `Second check disagrees: ${reason}`,
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
    panYard: "Pan the Yard",
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
    stages: { sent: "Sent", ready: "Ready", looking: "Looking", writing: "Writing", done: "Done" } satisfies Record<Stage, string>,
    counted: (done: number, total: number) => `${done} of ${total} steps done`,
    checked: "Checked. Opening what EmberWalk found.",
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
      conflict: TRY_AGAIN,
      not_ready: TRY_AGAIN,
      send_failed: TRY_AGAIN,
      spend_cap_reached: `EmberWalk has checked all the walks it can today. ${STAYS} Try again tomorrow.`,
      walk_limit_reached: `You have sent as many walks as EmberWalk allows today. ${STAYS} Try again tomorrow.`,
      walk_not_done: "This walk is still being checked.",
      rate_limited: `Too many tries in a short time. ${STAYS} Wait a minute, then tap ${SEND}.`,
      server_error: TRY_AGAIN,
    } satisfies Record<Failure, string>,
  },
} as const;
