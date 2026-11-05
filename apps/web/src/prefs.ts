import { Language, ViewPreference } from "@emberwalk/shared";
import { isJurisdiction } from "./location.ts";
import type { Jurisdiction } from "./location.ts";

export type Prefs = {
  introSeen(): boolean;
  markIntroSeen(): void;
  jurisdiction(): Jurisdiction | null;
  setJurisdiction(code: Jurisdiction): void;
  visitorId(): string;
  renewVisitorId(): string;
  view(): ViewPreference;
  setView(view: ViewPreference): void;
  agreedToSend(): boolean;
  markAgreedToSend(): void;
  language(): Language;
  setLanguage(chosen: Language): void;
  readsStepsAloud(): boolean;
  setReadsStepsAloud(on: boolean): void;
};

export const INTRO_SEEN_KEY = "emberwalk.introSeen";
export const JURISDICTION_KEY = "emberwalk.jurisdiction";
export const VISITOR_KEY = "emberwalk.visitorId";
export const VIEW_KEY = "emberwalk.view";
export const AGREED_KEY = "emberwalk.agreedToSend";
export const LANGUAGE_KEY = "emberwalk.language";
export const READ_ALOUD_KEY = "emberwalk.readStepsAloud";

const VISITOR_ID = /^[0-9a-f]{64}$/;

const newVisitorId = (): string =>
  [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const storagePrefs = (storage: () => Storage, phone: () => readonly string[] = () => navigator.languages): Prefs => {
  let spoken: Language | null = null;
  let seen = false;
  let chosen: Jurisdiction | null = null;
  let visitor: string | null = null;
  let view: ViewPreference | null = null;
  let agreed = false;
  let aloud: boolean | null = null;
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
    renewVisitorId: () => {
      visitor = newVisitorId();
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
    agreedToSend: () => agreed || read(AGREED_KEY) === "1",
    markAgreedToSend: () => {
      agreed = true;
      write(AGREED_KEY, "1");
    },
    language: () => {
      if (spoken !== null) return spoken;
      const stored = Language.safeParse(read(LANGUAGE_KEY));
      if (stored.success) return stored.data;
      return /^es\b/i.test(phone()[0] ?? "") ? "es" : "en";
    },
    setLanguage: (chosen) => {
      spoken = chosen;
      write(LANGUAGE_KEY, chosen);
    },
    readsStepsAloud: () => aloud ?? read(READ_ALOUD_KEY) !== "0",
    setReadsStepsAloud: (on) => {
      aloud = on;
      write(READ_ALOUD_KEY, on ? "1" : "0");
    },
  };
};
