import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { createContext, useContext } from "react";
import { uploadApi, walkApi } from "./api.ts";
import type { Fetch } from "./api.ts";
import { storageFindingMarks } from "./finding-marks.ts";
import type { FindingMarks } from "./finding-marks.ts";
import { apiResults, apiStills, samplesThenApi } from "./live-results.ts";
import type { Stills } from "./live-results.ts";
import { browserLocate } from "./location.ts";
import type { Locate } from "./location.ts";
import { browserMotion } from "./motion.ts";
import type { MotionEnv } from "./motion.ts";
import { storagePrefs } from "./prefs.ts";
import type { Prefs } from "./prefs.ts";
import type { Clock, MediaEnv } from "./recorder.ts";
import { keptResults, openResultsStore } from "./results-store.ts";
import { sampleResults } from "./samples.ts";
import type { LoadResults } from "./samples.ts";
import { walkSender } from "./sender.ts";
import type { Sender } from "./sender.ts";
import { openTakeStore } from "./take-store.ts";
import type { TakeStore } from "./take-store.ts";

export type Deps = {
  media: MediaEnv;
  takes: () => Promise<TakeStore>;
  clock: Clock;
  maxWalkMs: number;
  send: Sender;
  prefs: Prefs;
  motion: MotionEnv | null;
  locate: Locate;
  results: LoadResults;
  stills: Stills;
  marks: FindingMarks;
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
  return {
    media: { mediaDevices: navigator.mediaDevices, MediaRecorder: globalThis.MediaRecorder },
    takes,
    clock: realClock,
    maxWalkMs: MAX_WALK_MS,
    send: walkSender({ walks: walkApi(base, put), uploads: uploadApi(base, put), put, takes, visitorId: prefs.visitorId }),
    prefs,
    motion: browserMotion(window),
    locate: browserLocate(navigator.geolocation),
    results: keptResults(once(() => openResultsStore(indexedDB)), samplesThenApi(sampleResults, apiResults(walkApi(base, put, prefs.visitorId), base)), realClock),
    stills: apiStills(put, prefs.visitorId),
    marks: storageFindingMarks(() => localStorage),
  };
};

export const DepsContext = createContext<Deps | null>(null);

export const useDeps = (): Deps => {
  const deps = useContext(DepsContext);
  if (deps === null) throw new Error("a screen was rendered outside DepsContext");
  return deps;
};
