import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { createContext, useContext } from "react";
import { uploadApi, walkApi } from "./api.ts";
import { browserAwake } from "./awake.ts";
import type { Awake } from "./awake.ts";
import type { Fetch, WalkApi } from "./api.ts";
import { fixedApi } from "./fixed-api.ts";
import type { FixedApi } from "./fixed-api.ts";
import { storageFindingMarks } from "./finding-marks.ts";
import type { FindingMarks } from "./finding-marks.ts";
import { keptStills, browserShelf } from "./kept-stills.ts";
import { apiResults, apiStills, samplesThenApi } from "./live-api.ts";
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
import { noPortfolio, portfolioApi } from "./portfolio-api.ts";
import type { PortfolioApi } from "./portfolio-api.ts";
import { storagePrefs } from "./prefs.ts";
import type { Prefs } from "./prefs.ts";
import type { Clock, MediaEnv } from "./recorder.ts";
import { keptResults, openResultsStore } from "./results-store.ts";
import { sampleResults } from "./samples.ts";
import type { LoadResults } from "./samples.ts";
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
  awake: Awake;
};

export const MAX_WALK_MS = DEFAULT_LIMITS.maxWalkSeconds * 1000;

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

export const browserDeps = (): Deps => {
  const takes = once(() => openTakeStore(indexedDB));
  const prefs = storagePrefs(() => localStorage);
  const put: Fetch = (request) => fetch(request);
  const base = window.location.origin;
  const read = walkApi(base, put, prefs.visitorId);
  const fixed = fixedApi(base, put, prefs.visitorId);
  const aborts = pendingAborts(() => localStorage, (uploadId) => uploadApi(base, put).abort(uploadId));
  window.addEventListener("online", () => void aborts.retry());
  void aborts.retry();
  return {
    media: { mediaDevices: navigator.mediaDevices, MediaRecorder: globalThis.MediaRecorder },
    takes,
    clock: realClock,
    maxWalkMs: MAX_WALK_MS,
    send: aborts.before(
      walkSender({ walks: walkApi(base, put), uploads: uploadApi(base, put), put, takes, visitorId: prefs.visitorId, abort: aborts.abort }),
    ),
    live: (store, takeId, ready) =>
      liveUpload({ base, send: put, put, takes: store, visitorId: prefs.visitorId }, takeId, ready),
    abortUpload: aborts.abort,
    prefs,
    motion: browserMotion(window),
    light: browserLight(document),
    locate: browserLocate(navigator.geolocation),
    results: keptResults(once(() => openResultsStore(indexedDB)), samplesThenApi(sampleResults, apiResults(read, base)), realClock),
    walkStatus: read.status,
    reportFault: read.reportFault,
    build: BUILD,
    stills: keptStills(apiStills(put, prefs.visitorId), browserShelf),
    marks: storageFindingMarks(() => localStorage),
    sentWalks: storageSentWalks(() => localStorage),
    fixed,
    sync: storageMarkSync(() => localStorage, fixed.mark),
    phone: browserPhone(navigator, (url) => window.location.assign(url)),
    portfolio: JUDGE ? noPortfolio : portfolioApi(base, put, prefs.visitorId),
    awake: browserAwake(navigator, document),
  };
};

export const DepsContext = createContext<Deps | null>(null);

export const useDeps = (): Deps => {
  const deps = useContext(DepsContext);
  if (deps === null) throw new Error("a screen was rendered outside DepsContext");
  return deps;
};
