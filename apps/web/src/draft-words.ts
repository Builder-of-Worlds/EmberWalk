import { billingEs, crewEs, dashboardEs, deleteEverythingEs, demoEs, findingEs, inspectionEs, inviteEs, movedEs, portfolioEs, recheckEs, reportEs, settingsEs, shellEs, signInEs, welcomeEs } from "./draft-words-es.ts";
import type { RecheckResult } from "./finding-marks.ts";
import { follow } from "./language.ts";
import type { RecheckCode } from "./recheck-api.ts";
import type { ReportCode } from "./report-api.ts";

export const inspectionEn = {
  openForm: "Open CAL FIRE Form",
  goesTo: (agency: string, email: string): string => `This goes to ${agency} at ${email}, the address we have for them.`,
  source: "Source",
  readOn: (day: string): string => `Read on ${day}.`,
  nothingSent: "Nothing goes out until you tap Email The Department.",
  email: "Email The Department",
  sending: "Sending your email.",
  sent: (agency: string): string => `Sent to ${agency}. Their answer comes back here.`,
  replied: "What They Said",
};

export const inspectionWords = follow(inspectionEn, inspectionEs);

export const shellEn = {
  nav: "Main",
  home: "Home",
  walks: "Walks",
  fixes: "Fixes",
  homes: "Homes",
  settings: "Settings",
};

export const shellWords = follow(shellEn, shellEs);

export const welcomeEn = {
  lead: "One walk around your home with your phone. EmberWalk checks the 100 feet around it for what could carry fire to it, and shows what to fix first.",
  sample: "See a Sample House",
  installTitle: "Add EmberWalk to Your Home Screen",
  installIos: "Tap the Share button, then Add to Home Screen. EmberWalk then opens like an app.",
  installOther: "Open this page in Safari, tap the Share button, then Add to Home Screen.",
  install: "Add to Home Screen",
  gotIt: "Got It",
};

export const welcomeWords = follow(welcomeEn, welcomeEs);

export const dashboardEn = {
  greeting: (hour: number): string => (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"),
  yourHome: "Your Home",
  lastWalk: (day: string): string => `Last walk ${day}`,
  noWalk: "No walk yet. One walk around your home checks the 100 feet that matter most.",
  toFix: (n: number): string => (n === 1 ? "1 to fix" : `${n} to fix`),
  done: (n: number): string => `${n} done`,
  nextTitle: "Next Walk",
  nextAfterFixes: "Walk again once your first three fixes are done.",
  nextAfterWalk: "Your first fixes are done. Walk again now to record your after walk.",
  nextYearly: (day: string): string => `Your yearly walk is due ${day}.`,
  yearRound: "Keep the space around your home clear all year.",
  results: "See Results",
  fix: "Get It Fixed",
  walkAgain: "Walk My House Again",
};

export const dashboardWords = follow(dashboardEn, dashboardEs);

export const settingsEn = {
  title: "Settings",
  account: "Your Account",
  notSignedIn: "Not signed in. Your walks stay on this phone.",
  changeEmail: "Change Email",
  newEmail: "New Email",
  sendCode: "Send Code",
  codeSent: (email: string): string => `We sent a 6 digit code to ${email}. Type it here to move your account to that email.`,
  confirm: "Change My Email",
  changed: (email: string): string => `Your account now uses ${email}.`,
  taken: "Another EmberWalk account uses that email.",
  cancel: "Cancel",
  language: "Language",
  privacy: "Privacy",
  install: "Add to Home Screen",
  walk: "During Your Walk",
  readAloud: "Read each step out loud while you hold the phone up. When your walk records sound, the steps stay on screen so your own notes stay clear.",
  on: "On",
  off: "Off",
  reminders: "Reminder Emails",
  remindersLine: "One email each year before fire season, when your yearly walk is due, and one after a walk once its first fixes are done, to record your after walk.",
  remindersFailed: "That did not save. Check your signal and try again.",
  help: "Help",
  contact: "Contact Us",
};

export const settingsWords = follow(settingsEn, settingsEs);

export const crewEn = {
  entry: "List Your Crew",
  title: "List Your Crew",
  lead: "Licensed C-27 and C-49 crews can list here for free. Homeowners nearby can then email you quote requests, each one approved by the homeowner.",
  name: "Business Name",
  license: "California License Number",
  licenseClass: "License Class",
  classes: { "C-27": "C-27 Landscaping", "C-49": "C-49 Tree and Palm" },
  email: "Email For Requests",
  phone: "Phone (Optional)",
  zip: "Your ZIP Code",
  agree: "I want homeowners near me to email this crew quote requests through EmberWalk. Every email has a way off the list.",
  submit: "List My Crew",
  sending: "Checking your license.",
  checkEmail: "Check your email. Open the link we sent to finish listing your crew.",
  licenseListed: "This license is already listed on EmberWalk. If that is not your crew, write to hello@emberwalk.app.",
  licenseWaiting: "Someone started listing this license in the last day and has not confirmed it. If that was not you, try again tomorrow or write to hello@emberwalk.app.",
  mustAgree: "Check the box to list your crew.",
  badPhone: "Enter a 10 digit phone number, or leave it empty.",
  notListed: "The state license list does not show this number and class in good standing. This address may also have asked to come off our list.",
  back: "Back to About",
  nameYours: "Name Your Own Crew",
  crewName: "Crew Name",
  crewContact: "Their Email Or Phone",
  addCrew: "Add This Crew",
  needContact: "Enter an email address or a 10 digit phone number.",
  crewRefused: "This job cannot take another crew.",
};

export const crewWords = follow(crewEn, crewEs);

export const findingEn = {
  hear: "Hear It",
  help: "Help Near You",
  cannotHear: "Reading aloud is not available on this phone.",
  advice: "Our advice, not a rule",
};

export const findingWords = follow(findingEn, findingEs);

export const demoEn = {
  inboxTitle: "Demo Inbox",
  inboxLead: "This is a sample house, so requests stop here. No real crew gets them.",
  to: (address: string): string => `To ${address}`,
};

export const demoWords = follow(demoEn, demoEs);

export const phoneOf = (typed: string): string | null => {
  const digits = typed.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 && /^[\d\s()+.-]+$/.test(typed) ? `+1${ten}` : null;
};

export const deleteEverythingEn = {
  entry: "About and Privacy",
  title: "About and Privacy",
  notInspection: "This check is not an inspection, and it does not replace one.",
  rulesRead: (first: string, last: string): string =>
    first === last
      ? `The rules behind the sample walks were retrieved from their sources on ${first}.`
      : `The rules behind the sample walks were retrieved from their sources between ${first} and ${last}.`,
  heading: "Delete Everything",
  lead: "Delete Everything erases the walks EmberWalk holds for this phone, and clears its copies of them from this phone.",
  kept: "After Delete Everything, we keep your plan and payment records, the sign up list, the list of crews who asked not to be emailed, and a record of what each check cost, with no link to you or your walk.",
  start: "Delete Everything",
  confirm:
    "This erases the walks EmberWalk holds for this phone, with their pictures and results. Recordings not yet sent stay on this phone, apart from sides and corners recorded for those walks, which go with them. It cannot be undone.",
  yes: "Yes, Delete Everything",
  no: "Go Back",
  working: "Deleting your walks.",
  done: "Done. The walks EmberWalk held for this phone are erased. Recordings not yet sent stay on this phone, apart from sides and corners recorded for those walks.",
  busy: "A walk is still being sent or checked. Tap Delete Everything again when it is done.",
  offline: "No signal right now. Tap Delete Everything again when you have signal.",
  failed: "Delete Everything is not finished yet. Tap Delete Everything again to finish.",
  doneAccountKept:
    "Done. The walks EmberWalk held for this phone are erased. Your account's walks, plan and email are still kept. To erase those too, sign in with your email, open the link on this phone, then tap Delete Everything again. If you no longer have that email, write to hello@emberwalk.app.",
  signIn: "Sign In",
  signInFirst: "Sign in first, then tap Delete Everything again. Nothing has been deleted yet.",
  back: "Back to Home",
};

export const deleteEverythingWords = follow(deleteEverythingEn, deleteEverythingEs);

export const PORTFOLIO_KEY = "emberwalk.portfolio";

export const portfolioOpen = (storage: () => Pick<Storage, "getItem"> = () => window.localStorage): boolean => {
  try {
    return storage().getItem(PORTFOLIO_KEY) === "on";
  } catch {
    return false;
  }
};

export const closePortfolio = (): void => {
  try {
    window.localStorage.removeItem(PORTFOLIO_KEY);
    window.localStorage.setItem(ACCOUNT_LEFT_KEY, "on");
  } catch {
    return;
  }
};

const ACCOUNT_LEFT_KEY = "emberwalk.accountLeft";

export const accountLeftBehind = (): boolean => {
  try {
    return window.localStorage.getItem(ACCOUNT_LEFT_KEY) === "on";
  } catch {
    return false;
  }
};

export const markAccountLeft = (): void => {
  try {
    window.localStorage.setItem(ACCOUNT_LEFT_KEY, "on");
  } catch {
    return;
  }
};

const SIGN_IN_AGAIN_KEY = "emberwalk.signInAgain";

export const noteSignInAgain = (): void => {
  try {
    window.sessionStorage.setItem(SIGN_IN_AGAIN_KEY, "on");
  } catch {
    return;
  }
};

export const signInAgainNoted = (): boolean => {
  try {
    return window.sessionStorage.getItem(SIGN_IN_AGAIN_KEY) === "on";
  } catch {
    return false;
  }
};

export const openPortfolio = (): void => {
  try {
    window.localStorage.setItem(PORTFOLIO_KEY, "on");
    window.localStorage.removeItem(ACCOUNT_LEFT_KEY);
    window.sessionStorage.removeItem(SIGN_IN_AGAIN_KEY);
  } catch {
    return;
  }
};

export const movedEn = {
  signInAgain: "Your walks are in your account, and this phone's sign in has ended. Sign in again to see them.",
  signIn: "Sign In",
};

export const movedWords = follow(movedEn, movedEs);

const NO_SIGNAL = "No signal right now. Try again when you have signal.";

export const signInEn = {
  entry: "Sign In",
  title: "Sign In",
  lead: "Sign in with a code sent to your email. No password. You sign in once on this phone and stay signed in, and your walks and plan follow you to a new phone.",
  notLinked: "The walks and plan made on this phone are not part of your account yet. To add them, ask for a link on this phone and open it here.",
  heldPhone: "The walks and plan made on this phone stay out of your account, because this phone has signed in to another account.",
  signOutEverywhere: "Sign Out on Every Phone",
  walkBusy: "A walk is still being sent or checked. Sign out when it is done.",
  afterPurchase: "Your plan is on this phone. Sign in if you want to keep it when you change phones.",
  emailLabel: "Your Email",
  send: "Send My Code",
  waitForCheck: "One moment. EmberWalk is still checking this phone. Try again in a few seconds.",
  checkFailed: "EmberWalk needs to check that a person is asking for this link. Try again.",
  signedInAs: (email: string) => `Signed in as ${email}`,
  signOut: "Sign Out",
  codeSent: (email: string) => `We sent a 6 digit code to ${email}. Type it here. It ends in 15 minutes.`,
  codeLabel: "Your Code",
  enterCode: "Sign In",
  codeWrong: "That code does not match. Check the email and try again.",
  codeTries: "That code has been tried too many times. Ask for a new one.",
  codeEnded: "That code has ended. Ask for a new one.",
  newCode: "Send a New Code",
  checking: "Signing you in.",
  notSetUp: "Sign in is not set up yet.",
  mailFailed: "The email has not gone out yet. Try again.",
  tooMany: "EmberWalk has sent as many links as it allows for now. Try again in an hour.",
  badEmail: "That email does not look right. Check it and try again.",
  linkExpired: "This link has ended. Ask for a new one.",
  linkUsed: "This link has been used. Ask for a new one.",
  linkInvalid: "This link does not work. Ask for a new one.",
  askAgain: "Ask for a New Link",
  failed: "Please try again.",
  noSignal: NO_SIGNAL,
  back: "Back to Home",
};

export const signInWords = follow(signInEn, signInEs);

const countOf = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const portfolioEn = {
  entry: "Your Homes",
  title: "Your Homes",
  sampleLine: "These homes are samples, and they are made up.",
  empty: "No homes yet. Add the first one below.",
  status: { not_walked: "Not Walked Yet", needs_work: "Items to Fix", ready: "Ready" },
  openItems: (n: number): string => (n === 0 ? "No open items" : `${countOf(n, "open item", "open items")}`),
  lastWalk: (day: string): string => `Last walk ${day}`,
  noWalkYet: "No walk yet",
  open: "Open This Home",
  addLabel: "Name This Home",
  add: "Add Home",
  planNeeded: "More than one home needs the landlord plan.",
  addFailed: "That home has not been added yet. Try again.",
  walks: "Walks",
  noWalks: "No walks yet. Invite a tenant, or walk it yourself.",
  walkedOn: (day: string): string => `Walked ${day}`,
  byTenant: "Walked by a tenant",
  byYou: "Walked by you",
  stillChecking: "Still being checked.",
  notFinished: "Walk this home again to get results.",
  openHeading: "Open Items",
  doneHeading: "Fixed",
  requiredNow: "Required Now",
  recommended: "Recommended",
  markDone: "Mark Done",
  doneOn: (concept: string, day: string): string => `${concept}: Done ${day}`,
  markFailed: "That has not been saved yet. Try again.",
  results: "See Results",
  getItFixed: "Get It Fixed",
  invite: "Invite a Tenant",
  walkIt: "Walk This Home",
  record: "Download Dated Record",
  notFound: "This home is not on your list.",
  noSignal: NO_SIGNAL,
  failed: "Your homes are not showing yet. Try again.",
  backHomes: "Back to Your Homes",
  backHome: "Back to Home",
};

export const portfolioWords = follow(portfolioEn, portfolioEs);

export const inviteEn = {
  title: "Invite a Tenant",
  lead: "Make a link and send it to your tenant yourself. EmberWalk does not contact them and does not ask for their name, email or phone. It is good for one walk, for 7 days.",
  make: "Make Invite Link",
  ready: "Your invite link",
  copy: "Copy Link",
  copied: "Copied.",
  share: "Share Link",
  ends: (day: string): string => `Good until ${day}.`,
  tenantTitle: "You Are Invited to Walk This Home",
  tenantLead: "Your landlord or property manager asked you to check the space around this home. You do not need an account. Walk around the outside with your phone, and EmberWalk checks what it sees.",
  tenantShare: "The walk goes to the person who invited you, and you will see the results here too.",
  start: "Start the Walk",
  expired: "This invite has ended. Ask for a new one.",
  used: "This invite has been used. Ask for a new one.",
  removed: "This home is no longer on the list. Ask the person who invited you.",
  unknown: "This invite does not work. Ask for a new one.",
  noSignal: NO_SIGNAL,
  back: "Back to Home",
};

export const inviteWords = follow(inviteEn, inviteEs);

const TRY_LATER ="This photo has not been checked yet. You can try again in a little while.";

export const recheckEn = {
  entry: "Recheck This Item",
  title: "Recheck This Item",
  lead: "Stand where the first photo was taken and line up the faint picture with what you see now. Then tap Take Photo.",
  take: "Take Photo",
  checking: "Checking your new photo.",
  back: "Back to Results",
  sample: "This is a sample walk, so there is nothing to recheck.",
  useSample: "Use The Sample After Photo",
  sampleLead: "This is a made-up house, so there is nothing to photograph. This is its after picture.",
  sampleNote: "This is a sample answer. A real recheck sends your photo to EmberWalk's check and shows what it found.",
  notDone: "Mark this item Done first. Then you can recheck it here.",
  noCamera: "The camera is not open. Allow the camera for this site in your browser settings, then open this screen again.",
  noPhoto: "No photo yet. Tap Take Photo to try again.",
  answer: {
    cleared: "This item looks cleared in your new photo.",
    still_there: "This item still shows in your new photo. You can recheck it again after the next fix.",
    unsure: "This photo is not clear enough to tell. A closer photo in daylight usually helps.",
  } satisfies Record<RecheckResult, string>,
  failed: {
    offline: "No signal right now. Your photo was not sent. Tap Take Photo again when you have signal.",
    not_done: "Mark this item Done first. Then you can recheck it here.",
    no_photo: "The photo has not arrived. Tap Take Photo to send it again.",
    too_large: "This photo is too large to send. Tap Take Photo to try a new one.",
    too_many_rechecks: "This item has used all of its rechecks.",
    not_found: "This item is not in your record.",
    invalid_request: TRY_LATER,
    method_not_allowed: TRY_LATER,
    server_error: TRY_LATER,
  } satisfies Record<RecheckCode, string>,
};

export const recheckWords = follow(recheckEn, recheckEs);

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

export const reportEn = {
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
    server_error: "Your approval has not been saved yet. Tap Approve Blurred Photos to try again in a little while.",
  } satisfies Record<ReportCode, string>,
  share: {
    title: "Share Link",
    lead: "Anyone with this link can open the PDF of the report you approved. If your walk gets new photos, or you mark or recheck an item, the link waits until you approve your report again. Nothing else about your walk opens with it. The link stops working when you turn it off or use Delete Everything.",
    readFailed: "Your link has not been checked yet. Tap Make Share Link to try again. A link you already have stays the same.",
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
      server_error: "Your link has not been made yet. Tap Make Share Link to try again in a little while.",
    } satisfies Record<ReportCode, string>,
    stopFailed: {
      ...reportFailed,
      offline: "No signal right now. Tap Turn Off Link again when you have signal.",
      timeout: "Turning off your link is taking longer than usual. Tap Turn Off Link to try again.",
      server_error: "Your link is not turned off yet. Tap Turn Off Link to try again in a little while.",
    } satisfies Record<ReportCode, string>,
  },
};

export const reportWords = follow(reportEn, reportEs);

export const billingEn = {
  entry: "Your Plan",
  title: "Your Plan",
  loading: "Loading your plan.",
  notOpen: "Plans are not on sale yet.",
  noSignal: "No signal right now. Try again when you have signal.",
  failed: "Your plan is not showing yet. Tap Try Again.",
  tryAgain: "Try Again",
  home: "Back Home",
  lead: "Every walk of a real house needs a plan. A plan renews each year until you cancel. You pay on Stripe's page.",
  sampleFree: "The sample walk is free, and a walk that does not finish never counts.",
  name: { individual: "Individual", landlord: "Landlord and Property Manager" },
  price: (amount: string): string => `${amount} a year`,
  walksAYear: (n: number): string => `${n} walks a year`,
  buyPlan: (amount: string): string => `Buy for ${amount} a Year`,
  leaving: "Opening Stripe.",
  cancelled: "You left Stripe's page. If you did not finish paying, you were not charged.",
  done: "Thank you. Your plan is ready.",
  doneExtra: "Thank you. Your extra walks are added.",
  confirming: "Stripe is confirming your payment. This can take a minute.",
  stillConfirming: "Stripe has not confirmed your payment yet. There is no need to buy again. Tap Check Again in a few minutes.",
  checkAgain: "Check Again",
  notHere: "EmberWalk does not see a plan here. If you just paid, open EmberWalk in the browser or app where you started, and your plan is there. If you did not pay, you can choose a plan below.",
  countUnread: "EmberWalk cannot read your walk count right now. There is no need to buy again. Tap Check Again in a few minutes.",
  extraOnWay: "Thank you. Your extra walks show in your count once Stripe confirms them.",
  toLandlord: "More than one home needs the Landlord and Property Manager plan. To change to it, write to hello@emberwalk.app.",
  walksLine: (used: number, left: number): string => `${countOf(used, "walk", "walks")} used, ${left} left this plan year.`,
  yearEnds: (day: string): string => `This plan year ends ${day}.`,
  pastDue: "Your last payment needs your card updated. Tap Manage or Cancel to update your card.",
  onHold: "This plan is on hold. Tap Manage or Cancel to see what it needs.",
  refunded: "This plan was refunded, so it cannot start new walks. Tap Manage or Cancel to see it.",
  ended: "Your plan has ended. Choose a plan to walk again.",
  manage: "Manage or Cancel",
  extraHeading: "Extra Walks",
  extraLead: (amount: string): string => `${amount} each. Unused extra walks carry into the next year.`,
  extraCount: "How Many",
  buyExtra: (n: number, amount: string): string => `Buy ${n} for ${amount}`,
  stripeDown: "Stripe is not answering yet. Try again.",
  notAvailable: "Buying is not available right now.",
  already: "You already have a plan.",
  didNotWork: "That did not work. Try again.",
  choosePlan: "Choose a Plan",
  seePlan: "See Your Plan",
};

export const billingWords = follow(billingEn, billingEs);
