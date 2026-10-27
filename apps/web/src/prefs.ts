import { ViewPreference } from "@emberwalk/shared";
import { isJurisdiction } from "./location.ts";
import type { Jurisdiction } from "./location.ts";

export type Prefs = {
  introSeen(): boolean;
  markIntroSeen(): void;
  jurisdiction(): Jurisdiction | null;
  setJurisdiction(code: Jurisdiction): void;
  visitorId(): string;
  view(): ViewPreference;
  setView(view: ViewPreference): void;
};

export const INTRO_SEEN_KEY = "emberwalk.introSeen";
export const JURISDICTION_KEY = "emberwalk.jurisdiction";
export const VISITOR_KEY = "emberwalk.visitorId";
export const VIEW_KEY = "emberwalk.view";

const VISITOR_ID = /^[0-9a-f]{64}$/;

const newVisitorId = (): string =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const storagePrefs = (storage: () => Storage): Prefs => {
  let seen = false;
  let chosen: Jurisdiction | null = null;
  let visitor: string | null = null;
  let view: ViewPreference | null = null;
  const read = (key: string): string | null => {
    try {
      return storage().getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string) => {
    try {
      storage().setItem(key, value);
    } catch {
      return;
    }
  };
  return {
    introSeen: () => seen || read(INTRO_SEEN_KEY) === "1",
    markIntroSeen: () => {
      seen = true;
      write(INTRO_SEEN_KEY, "1");
    },
    jurisdiction: () => {
      if (chosen !== null) return chosen;
      const stored = read(JURISDICTION_KEY);
      return isJurisdiction(stored) ? stored : null;
    },
    setJurisdiction: (code) => {
      chosen = code;
      write(JURISDICTION_KEY, code);
    },
    visitorId: () => {
      if (visitor !== null) return visitor;
      const stored = read(VISITOR_KEY);
      visitor = stored !== null && VISITOR_ID.test(stored) ? stored : newVisitorId();
      write(VISITOR_KEY, visitor);
      return visitor;
    },
    view: () => {
      if (view !== null) return view;
      const stored = ViewPreference.safeParse(read(VIEW_KEY));
      return stored.success ? stored.data : "simple";
    },
    setView: (chosen) => {
      view = chosen;
      write(VIEW_KEY, chosen);
    },
  };
};
