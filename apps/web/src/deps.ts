import { DEFAULT_LIMITS, limitsWith } from "@emberwalk/shared";
import type { Limits } from "@emberwalk/shared";
import { createContext, useContext } from "react";
import { uploadApi, walkApi } from "./api.ts";
import { browserAwake } from "./awake.ts";
import { eraseApi } from "./erase-api.ts";
import type { EraseApi } from "./erase-api.ts";
import type { Awake } from "./awake.ts";
import type { Fetch, WalkApi } from "./api.ts";
import { demoFixed, withDemo } from "./demo-fixed.ts";
import { fixedApi } from "./fixed-api.ts";
import type { FixedApi } from "./fixed-api.ts";
import { storageFindingMarks } from "./finding-marks.ts";
import { forgetSent } from "./forget-sent.ts";
import type { ForgetSent } from "./forget-sent.ts";
import type { FindingMarks } from "./finding-marks.ts";
import { keptStills, browserShelf } from "./kept-stills.ts";
import { apiResults, apiStills, samplesThenApi } from "./live-api.ts";
import { notingSignInAgain } from "./noting-sign-in.ts";
import type { Stills } from "./live-api.ts";
import { browserLight } from "./light.ts";
import type { LightEnv } from "./light.ts";
import { browserLocate } from "./location.ts";
import type { Locate } from "./location.ts";
import { storageMarkSync } from "./mark-sync.ts";
import type { MarkSync } from "./mark-sync.ts";
import { liveUpload } from "./live-upload.ts";
import type { LiveUpload } from "./live-upload.ts";
import { browserMotion } from "./motion.ts";
import type { MotionEnv } from "./motion.ts";
import { browserPhone } from "./phone.ts";
import type { PhoneEnv } from "./phone.ts";
import { JUDGE } from "./judge.ts";
import { accountApi, noAccount } from "./account-api.ts";
import type { AccountApi } from "./account-api.ts";
import { billingApi, noBilling } from "./billing-api.ts";
import type { BillingApi } from "./billing-api.ts";
import { portfolioApi } from "./portfolio-api.ts";
import { samplePortfolio } from "./samples/portfolio.ts";
import type { PortfolioApi } from "./portfolio-api.ts";
import { storagePrefs } from "./prefs.ts";
import type { Prefs } from "./prefs.ts";
import type { Clock, MediaEnv } from "./recorder.ts";
import { recheckApi } from "./recheck-api.ts";
import type { RecheckApi } from "./recheck-api.ts";
import { browserCopy, browserSave, reportApi } from "./report-api.ts";
import type { ReportApi } from "./report-api.ts";
import { keptResults, openResultsStore } from "./results-store.ts";
import { judgeDeps } from "./judge-demo.ts";
import { SAMPLE_RECHECKS, SAMPLES, sampleResults } from "./samples.ts";
import type { LoadResults, SampleRechecks } from "./samples.ts";
import { browserVoice, browserVoiceEnv } from "./voice.ts";
import type { Voice } from "./voice.ts";
import { storageSentWalks } from "./sent-walks.ts";
import type { SentWalks } from "./sent-walks.ts";
import { walkSender } from "./sender.ts";
import type { Sender } from "./sender.ts";
import { openTakeStore } from "./take-store.ts";
import type { TakeStore } from "./take-store.ts";
import { pendingAborts } from "./uploader.ts";
import type { WalkStatus } from "./watch.ts";

declare const __EMBERWALK_BUILD__: string;

export const BUILD = typeof __EMBERWALK_BUILD__ === "string" ? __EMBERWALK_BUILD__ : "dev";

export type Deps = {
  media: MediaEnv;
  erase: EraseApi;
  forgetSent: ForgetSent;
  takes: () => Promise<TakeStore>;
  clock: Clock;
  maxWalkMs: number;
  send: Sender;
  live: (takes: TakeStore, takeId: string, ready: Promise<unknown>) => LiveUpload;
  abortUpload: (uploadId: string) => Promise<unknown>;
  prefs: Prefs;
  motion: MotionEnv | null;
  light: LightEnv;
  locate: Locate;
  results: LoadResults;
  walkStatus: WalkStatus;
  reportFault: WalkApi["reportFault"];
  build: string;
  stills: Stills;
  marks: FindingMarks;
  sentWalks: SentWalks;
  fixed: FixedApi;
  sync: MarkSync;
  phone: PhoneEnv;
  portfolio: PortfolioApi;
  account: AccountApi;
  billing: BillingApi;
  awake: Awake;
  limits: Limits;
  rechecks: RecheckApi;
  sampleRechecks: SampleRechecks;
  voice: Voice;
  report?: ReportApi;
};

export const MAX_WALK_MS = DEFAULT_LIMITS.maxWalkSeconds * 1000;

export const limitsFrom = (raw: string | undefined): Limits => {
  if (raw === undefined) return DEFAULT_LIMITS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return DEFAULT_LIMITS;
    return limitsWith(parsed as Partial<Limits>);
  } catch {
    return DEFAULT_LIMITS;
  }
};

export const realClock: Clock = {
  now: () => Date.now(),
  later: (run, ms) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
};

export const once = <T>(make: () => Promise<T>): (() => Promise<T>) => {
  let made: Promise<T> | null = null;
  return () => (made ??= make());
};

export const appDeps = (): Deps => (JUDGE ? judgeDeps(browserDeps(), SAMPLES[0]!) : browserDeps());

export const browserDeps = (): Deps => {
  const takes = once(() => openTakeStore(indexedDB));
  const prefs = storagePrefs(() => localStorage);
  const put: Fetch = (request) => fetch(request);
  const base = window.location.origin;
  const noting = notingSignInAgain(put);
  const read = walkApi(base, noting, prefs.visitorId);
  const fixed = fixedApi(base, noting, prefs.visitorId);
  const aborts = pendingAborts(() => localStorage, (uploadId) => uploadApi(base, put).abort(uploadId));
  window.addEventListener("online", () => void aborts.retry());
  void aborts.retry();
  const kept = once(() => openResultsStore(indexedDB));
  const marks = storageFindingMarks(() => localStorage);
  const sentWalks = storageSentWalks(() => localStorage);
  const results = keptResults(kept, samplesThenApi(sampleResults, apiResults(read, base)), realClock);
  const sync = storageMarkSync(() => localStorage, fixed.mark);
  return {
    media: { mediaDevices: navigator.mediaDevices, MediaRecorder: globalThis.MediaRecorder },
    erase: eraseApi(base, put, prefs.visitorId),
    forgetSent: forgetSent({ prefs, takes, sentWalks, results: kept, shelf: browserShelf, marks, sync }),
    takes,
    clock: realClock,
    maxWalkMs: MAX_WALK_MS,
    send: aborts.before(
      walkSender({ walks: walkApi(base, noting), uploads: uploadApi(base, put), put, takes, visitorId: prefs.visitorId, abort: aborts.abort }),
    ),
    live: (store, takeId, ready) =>
      liveUpload({ base, send: put, put, takes: store, visitorId: prefs.visitorId }, takeId, ready),
    abortUpload: aborts.abort,
    prefs,
    motion: browserMotion(window),
    light: browserLight(document),
    locate: browserLocate(navigator.geolocation),
    results,
    walkStatus: read.status,
    reportFault: read.reportFault,
    build: BUILD,
    stills: keptStills(apiStills(put, prefs.visitorId), browserShelf),
    marks,
    sentWalks,
    fixed: withDemo(fixed, demoFixed({ results, samples: SAMPLES, marks, now: () => new Date(realClock.now()), storage: localStorage }), results),
    sync,
    phone: browserPhone(navigator, (url) => window.location.assign(url)),
    portfolio: JUDGE ? samplePortfolio : portfolioApi(base, put, prefs.visitorId),
    account: JUDGE ? noAccount : accountApi(base, put, prefs.visitorId),
    billing: JUDGE ? noBilling : billingApi(base, put, prefs.visitorId, (url) => window.location.assign(url)),
    awake: browserAwake(navigator, document),
    limits: limitsFrom(import.meta.env.VITE_EMBERWALK_LIMITS as string | undefined),
    rechecks: recheckApi(base, noting, prefs.visitorId),
    sampleRechecks: SAMPLE_RECHECKS,
    voice: browserVoice(browserVoiceEnv(window)),
    ...(!JUDGE ? { report: reportApi(base, noting, prefs.visitorId, browserSave(document), browserCopy(navigator)) } : {}),
  };
};

export const DepsContext = createContext<Deps | null>(null);

export const useDeps = (): Deps => {
  const deps = useContext(DepsContext);
  if (deps === null) throw new Error("a screen was rendered outside DepsContext");
  return deps;
};
