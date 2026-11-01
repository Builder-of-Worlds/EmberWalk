import type { RecheckResult } from "./finding-marks.ts";
import type { RecheckCode } from "./recheck-api.ts";
import type { ReportCode } from "./report-api.ts";

export const DRAFT_WORDS_KEY = "emberwalk.draftWords";

export const deleteEverythingWords = {
  entry: "About and Privacy",
  title: "About and Privacy",
  notInspection: "This check is not an inspection, and it does not replace one.",
  rulesRead: (first: string, last: string): string =>
    first === last
      ? `The rules this check uses were retrieved from their sources on ${first}.`
      : `The rules this check uses were retrieved from their sources between ${first} and ${last}.`,
  heading: "Delete Everything",
  lead: "Delete Everything erases the walks EmberWalk holds for this phone, and clears its copies of them from this phone.",
  kept: "After Delete Everything, we keep only a record of what each check cost, with no link to you or your walk.",
  start: "Delete Everything",
  confirm:
    "This erases the walks EmberWalk holds for this phone, with their pictures and results. Recordings not yet sent stay on this phone, apart from sides and corners recorded for those walks, which go with them. It cannot be undone.",
  yes: "Yes, Delete Everything",
  no: "Go Back",
  working: "Deleting your walks.",
  done: "Done. The walks EmberWalk held for this phone are erased. Recordings not yet sent stay on this phone, apart from sides and corners recorded for those walks.",
  busy: "A walk is still being sent or checked. Tap Delete Everything again when it is done.",
  offline: "No signal right now. Tap Delete Everything again when you have signal.",
  failed: "EmberWalk could not finish. Tap Delete Everything again to finish.",
  back: "Back to Home",
};

export const draftWordsShown = (storage: () => Pick<Storage, "getItem"> = () => window.localStorage): boolean => {
  try {
    return storage().getItem(DRAFT_WORDS_KEY) === "on";
  } catch {
    return false;
  }
};

const TRY_LATER = "EmberWalk could not check this photo. You can try again in a little while.";

export const recheckWords = {
  entry: "Recheck This Item",
  title: "Recheck This Item",
  lead: "Stand where the first photo was taken and line up the faint picture with what you see now. Then tap Take Photo.",
  take: "Take Photo",
  checking: "Checking your new photo.",
  back: "Back to Results",
  sample: "This is a sample walk, so there is nothing to recheck.",
  notDone: "Mark this item Done first. Then you can recheck it here.",
  noCamera: "EmberWalk cannot open the camera. Allow the camera for this site in your browser settings, then open this screen again.",
  noPhoto: "EmberWalk could not take the photo. Tap Take Photo to try again.",
  answer: {
    cleared: "This item looks cleared in your new photo.",
    still_there: "This item still shows in your new photo. You can recheck it again after the next fix.",
    unsure: "EmberWalk could not tell from this photo. A closer photo in daylight usually helps.",
  } satisfies Record<RecheckResult, string>,
  failed: {
    offline: "No signal right now. Your photo was not sent. Tap Take Photo again when you have signal.",
    not_done: "Mark this item Done first. Then you can recheck it here.",
    no_photo: "The photo did not arrive. Tap Take Photo to send it again.",
    too_large: "This photo is too large to send. Tap Take Photo to try a new one.",
    too_many_rechecks: "This item has used all of its rechecks.",
    not_found: "EmberWalk cannot find this item in your record.",
    invalid_request: TRY_LATER,
    method_not_allowed: TRY_LATER,
    server_error: TRY_LATER,
  } satisfies Record<RecheckCode, string>,
};

const REPORT_LATER = "Your report is not ready just now. You can open it again in a little while.";

const NOT_A_REPORT = "This link does not open a report. Go back to your results to find yours.";

const reportFailed = {
  offline: "No signal right now. Open your report again when you have signal.",
  timeout: "Your report is taking longer than usual. Open it again in a little while.",
  walk_not_done: "This walk is still being checked. Your report will be here when it is done.",
  conflict: "Approve the blurred photos below first. Then you can download your report.",
  body_too_large: "This walk has more photos than one report can hold.",
  invalid_request: NOT_A_REPORT,
  unknown_walk: "This walk is not in your record on this phone.",
  not_found: "Reports are not open yet.",
  method_not_allowed: NOT_A_REPORT,
  server_error: REPORT_LATER,
} satisfies Record<ReportCode, string>;

export const reportWords = {
  entry: "Your Report",
  title: "Your Report",
  lead: "This is the record of this walk, the same pages as the PDF.",
  loading: "Getting your report ready.",
  preview: "Report preview",
  checkPhotos: "Look at every photo in your report. Faces, license plates, house numbers, street signs and mailboxes should be blurred. Approve only when they are.",
  checkAgain:
    "Your report changed after you approved it. Look at every photo again. Faces, license plates, house numbers, street signs and mailboxes should be blurred. Approve only when they are.",
  approve: "Approve Blurred Photos",
  approving: "Saving your approval.",
  approved: (on: string) => `You approved the blurred photos on ${on}. You can download your report now.`,
  download: "Download PDF",
  making: "Making your PDF.",
  back: "Back to Results",
  failed: reportFailed,
  pdfFailed: {
    ...reportFailed,
    offline: "No signal right now. Tap Download PDF again when you have signal.",
    timeout: "Your PDF is taking longer than usual. Tap Download PDF to try again.",
    server_error: "Your PDF is not ready just now. Tap Download PDF to try again in a little while.",
  } satisfies Record<ReportCode, string>,
  approveFailed: {
    ...reportFailed,
    offline: "No signal right now. Tap Approve Blurred Photos again when you have signal.",
    timeout: "Your approval is taking longer than usual. Tap Approve Blurred Photos to try again.",
    server_error: "Your approval was not saved just now. Tap Approve Blurred Photos to try again in a little while.",
  } satisfies Record<ReportCode, string>,
  share: {
    title: "Share Link",
    lead: "Anyone with this link can open the PDF of the report you approved. If your walk gets new photos, or you mark or recheck an item, the link waits until you approve your report again. Nothing else about your walk opens with it. The link stops working when you turn it off or use Delete Everything.",
    readFailed: "Your link could not be checked just now. Tap Make Share Link to try again. A link you already have stays the same.",
    make: "Make Share Link",
    making: "Making your link.",
    copy: "Copy Link",
    copied: "Link copied.",
    copyFailed: "Press and hold the link to copy it.",
    stop: "Turn Off Link",
    stopping: "Turning off your link.",
    stopped: "Your link is off. It no longer opens your report.",
    makeFailed: {
      ...reportFailed,
      offline: "No signal right now. Tap Make Share Link again when you have signal.",
      timeout: "Your link is taking longer than usual. Tap Make Share Link to try again.",
      server_error: "Your link was not made just now. Tap Make Share Link to try again in a little while.",
    } satisfies Record<ReportCode, string>,
    stopFailed: {
      ...reportFailed,
      offline: "No signal right now. Tap Turn Off Link again when you have signal.",
      timeout: "Turning off your link is taking longer than usual. Tap Turn Off Link to try again.",
      server_error: "Your link was not turned off just now. Tap Turn Off Link to try again in a little while.",
    } satisfies Record<ReportCode, string>,
  },
};
